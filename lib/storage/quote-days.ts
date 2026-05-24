/**
 * Per-quote day snapshot. Source of truth for holiday status on each day
 * of a quote — snapshotted from job_request_days at draft creation, then
 * editable on drafts until issue. Frozen quotes get write-blocked by the
 * quote_days_freeze_check trigger.
 *
 * Companion migration: supabase/migrations/20260524c_quote_days.sql
 * Design: project_holiday_handling.md (Pattern C)
 */

import { supabase } from "@/lib/supabase/client";

export type QuoteDay = {
  id: string;
  quoteId: string;
  quoteDate: string;   // YYYY-MM-DD
  isHoliday: boolean;
};

function rowToQuoteDay(r: any): QuoteDay {
  return {
    id: r.id,
    quoteId: r.quote_id,
    quoteDate: r.quote_date,
    isHoliday: !!r.is_holiday,
  };
}

function newQuoteDayId(quoteId: string, quoteDate: string): string {
  // Mirror the deterministic id pattern used in the migration's backfill
  // (md5(quote_id || '|' || quote_date) so UI-side creation collides with
  // any existing row instead of duplicating).
  // Browser-friendly: skip crypto, just use a stable hash.
  const s = `${quoteId}|${quoteDate}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `qd-${Math.abs(h).toString(36)}-${quoteDate.replace(/-/g, "")}`;
}

/** Load all quote_days rows for a quote, keyed by date for convenient
 *  lookup from the editor. */
export async function loadQuoteDays(quoteId: string): Promise<QuoteDay[]> {
  const { data, error } = await supabase
    .from("quote_days")
    .select("*")
    .eq("quote_id", quoteId)
    .order("quote_date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToQuoteDay);
}

/** Upsert a single quote_day. Blocked by trigger on frozen quotes. */
export async function upsertQuoteDay(d: Omit<QuoteDay, "id"> & { id?: string }): Promise<QuoteDay> {
  const id = d.id || newQuoteDayId(d.quoteId, d.quoteDate);
  const { data, error } = await supabase
    .from("quote_days")
    .upsert(
      { id, quote_id: d.quoteId, quote_date: d.quoteDate, is_holiday: d.isHoliday },
      { onConflict: "id" },
    )
    .select()
    .single();
  if (error) throw error;
  return rowToQuoteDay(data);
}

/** Toggle holiday flag for a specific (quote, date). Creates the row if
 *  missing (some drafts may have lines on a date not in the original
 *  job_request_days backfill — covers the "user added a day in the editor"
 *  edge case). */
export async function setQuoteDayHoliday(
  quoteId: string,
  quoteDate: string,
  isHoliday: boolean,
): Promise<QuoteDay> {
  return upsertQuoteDay({ quoteId, quoteDate, isHoliday });
}

/** Snapshot job_request_days.is_holiday into quote_days for a freshly-
 *  created draft. Idempotent via unique (quote_id, quote_date). Call this
 *  immediately after persistDraft() in createDraftFromJob. */
export async function snapshotQuoteDaysFromJob(
  quoteId: string,
  jobRequestId: string,
): Promise<void> {
  const { data: dayRows, error: dayErr } = await supabase
    .from("job_request_days")
    .select("event_date, is_holiday")
    .eq("job_request_id", jobRequestId);
  if (dayErr) throw dayErr;
  if (!dayRows || dayRows.length === 0) return;

  const rows = dayRows.map((d: any) => ({
    id: newQuoteDayId(quoteId, d.event_date),
    quote_id: quoteId,
    quote_date: d.event_date,
    is_holiday: !!d.is_holiday,
  }));
  const { error } = await supabase
    .from("quote_days")
    .upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

/** Snapshot from a parent (frozen) quote's quote_days into a new revision
 *  draft. Preserves the parent's holiday decisions so the revision starts
 *  with the same money math; user can toggle them on the draft. */
export async function snapshotQuoteDaysFromParent(
  newQuoteId: string,
  parentQuoteId: string,
): Promise<void> {
  const parent = await loadQuoteDays(parentQuoteId);
  if (parent.length === 0) return;
  const rows = parent.map((d) => ({
    id: newQuoteDayId(newQuoteId, d.quoteDate),
    quote_id: newQuoteId,
    quote_date: d.quoteDate,
    is_holiday: d.isHoliday,
  }));
  const { error } = await supabase
    .from("quote_days")
    .upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

/** Convenience: build a Map<quoteDate, isHoliday> for the editor's render
 *  loop. Missing dates default to false. */
export function holidayLookup(days: QuoteDay[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const d of days) m.set(d.quoteDate, d.isHoliday);
  return m;
}
