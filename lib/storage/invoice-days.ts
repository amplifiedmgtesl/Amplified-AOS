/**
 * Per-invoice day snapshot. Mirror of lib/storage/quote-days.ts for the
 * invoice side. Source-of-truth chain:
 *   job_request_days  →  quote_days  →  invoice_days
 * Each entity stores its own snapshot so frozen records preserve the
 * holiday treatment current at issue time. The invoice_days_freeze_check
 * trigger blocks writes once the parent invoice is is_draft=false.
 *
 * Companion: supabase/migrations/20260524d_invoice_days.sql
 * Design: project_holiday_handling.md (Pattern C)
 */

import { supabase } from "@/lib/supabase/client";

export type InvoiceDay = {
  id: string;
  invoiceId: string;
  invoiceDate: string;   // YYYY-MM-DD
  isHoliday: boolean;
};

function rowToInvoiceDay(r: any): InvoiceDay {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    invoiceDate: r.invoice_date,
    isHoliday: !!r.is_holiday,
  };
}

function newInvoiceDayId(invoiceId: string, invoiceDate: string): string {
  // Mirror the deterministic id pattern from the backfill so UI-side
  // creation collides instead of duplicating.
  const s = `${invoiceId}|${invoiceDate}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `id-${Math.abs(h).toString(36)}-${invoiceDate.replace(/-/g, "")}`;
}

export async function loadInvoiceDays(invoiceId: string): Promise<InvoiceDay[]> {
  const { data, error } = await supabase
    .from("invoice_days")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("invoice_date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToInvoiceDay);
}

export async function upsertInvoiceDay(d: Omit<InvoiceDay, "id"> & { id?: string }): Promise<InvoiceDay> {
  const id = d.id || newInvoiceDayId(d.invoiceId, d.invoiceDate);
  const { data, error } = await supabase
    .from("invoice_days")
    .upsert(
      { id, invoice_id: d.invoiceId, invoice_date: d.invoiceDate, is_holiday: d.isHoliday },
      { onConflict: "id" },
    )
    .select()
    .single();
  if (error) throw error;
  return rowToInvoiceDay(data);
}

export async function setInvoiceDayHoliday(
  invoiceId: string,
  invoiceDate: string,
  isHoliday: boolean,
): Promise<InvoiceDay> {
  return upsertInvoiceDay({ invoiceId, invoiceDate, isHoliday });
}

/** Snapshot quote_days → invoice_days at draft creation. Preferred source
 *  for invoices generated from a frozen quote: preserves the exact holiday
 *  decisions that produced the quote's totals. */
export async function snapshotInvoiceDaysFromQuote(
  invoiceId: string,
  sourceQuoteId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("quote_days")
    .select("quote_date, is_holiday")
    .eq("quote_id", sourceQuoteId);
  if (error) throw error;
  if (!data || data.length === 0) return;
  const rows = data.map((d: any) => ({
    id: newInvoiceDayId(invoiceId, d.quote_date),
    invoice_id: invoiceId,
    invoice_date: d.quote_date,
    is_holiday: !!d.is_holiday,
  }));
  const { error: upErr } = await supabase
    .from("invoice_days")
    .upsert(rows, { onConflict: "id" });
  if (upErr) throw upErr;
}

/** Fallback snapshot from job_request_days when no source quote exists or
 *  the source quote has no quote_days. Used by overwriteFromTimesheets and
 *  any future "create invoice directly from job" flow. */
export async function snapshotInvoiceDaysFromJob(
  invoiceId: string,
  jobRequestId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("job_request_days")
    .select("event_date, is_holiday")
    .eq("job_request_id", jobRequestId);
  if (error) throw error;
  if (!data || data.length === 0) return;
  const rows = data.map((d: any) => ({
    id: newInvoiceDayId(invoiceId, d.event_date),
    invoice_id: invoiceId,
    invoice_date: d.event_date,
    is_holiday: !!d.is_holiday,
  }));
  const { error: upErr } = await supabase
    .from("invoice_days")
    .upsert(rows, { onConflict: "id" });
  if (upErr) throw upErr;
}

/** Snapshot from a parent (frozen) invoice's invoice_days into a new
 *  revision draft. Preserves the parent's holiday decisions; user can
 *  re-toggle on the draft. */
export async function snapshotInvoiceDaysFromParent(
  newInvoiceId: string,
  parentInvoiceId: string,
): Promise<void> {
  const parent = await loadInvoiceDays(parentInvoiceId);
  if (parent.length === 0) return;
  const rows = parent.map((d) => ({
    id: newInvoiceDayId(newInvoiceId, d.invoiceDate),
    invoice_id: newInvoiceId,
    invoice_date: d.invoiceDate,
    is_holiday: d.isHoliday,
  }));
  const { error } = await supabase
    .from("invoice_days")
    .upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export function invoiceHolidayLookup(days: InvoiceDay[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const d of days) m.set(d.invoiceDate, d.isHoliday);
  return m;
}
