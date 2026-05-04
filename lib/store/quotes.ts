/**
 * lib/store/quotes.ts
 *
 * Single source of truth for quote operations after the Phase A rewrite.
 *
 * Replaces the scattered upsertQuote / quote-draft-workspace / slug logic that
 * lived in lib/store/db.ts. All writes go through here; the freeze trigger on
 * the DB side is the structural backstop that keeps frozen quotes immutable.
 *
 * Companion: docs/quote-rewrite-plan.md
 *
 * Pattern:
 *  - Async functions, await Supabase calls, surface errors to the caller.
 *  - No fire-and-forget cache writes — the caller decides what to do on failure.
 *  - id namespace: q-{ulid-ish} for new rows; legacy ids preserved as-is on
 *    rows that pre-date the rewrite.
 */

import { supabase } from "@/lib/supabase/client";
import type { QuoteDraft, QuoteLine, JobRequest } from "./types";

// ─── ID generation ───────────────────────────────────────────────────────────

/** Time-sortable, collision-free id for new quote rows. Not a true ULID — uses
 *  Date.now() + random suffix; close enough for our row volumes. */
function newQuoteId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newLineId(): string {
  return `ql-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Row ↔ Object conversion ─────────────────────────────────────────────────

function rowToQuote(r: any, lineRows: any[] = []): QuoteDraft {
  return {
    id: r.id,
    clientId: r.client_id ?? undefined,
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    cityState: r.city_state ?? "",
    startDate: r.start_date ?? "",
    endDate: r.end_date ?? "",
    startTime: r.start_time ?? "",
    endTime: r.end_time ?? "",
    expectedHoursPerDay: r.expected_hours_per_day ?? undefined,
    total: r.total ?? 0,
    deposit: r.deposit ?? 0,
    status: r.status ?? null,
    notes: r.notes ?? "",
    lines: lineRows.map(rowToQuoteLine),
    terms: r.terms ?? "",
    linkedJobRequestId: r.linked_job_request_id ?? undefined,
    linkedJobSheetId: r.linked_job_sheet_id ?? undefined,
    timesheetSummary: r.timesheet_summary ?? undefined,
    signatureName: r.signature_name ?? undefined,
    signedAt: r.signed_at ?? undefined,
    signedBy: r.signed_by ?? undefined,
    rateCardProfileId: r.rate_card_profile_id ?? undefined,
    isDraft: r.is_draft ?? true,
    jobRequestId: r.job_request_id ?? undefined,
    parentQuoteId: r.parent_quote_id ?? undefined,
    quoteNo: r.quote_no ?? undefined,
    revisionNo: r.revision_no ?? 1,
    issuedAt: r.issued_at ?? undefined,
    issuedBy: r.issued_by ?? undefined,
    supersededAt: r.superseded_at ?? undefined,
    supersededBy: r.superseded_by ?? undefined,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    updatedBy: r.updated_by ?? undefined,
  };
}

function rowToQuoteLine(r: any): QuoteLine {
  return {
    serviceKey:   r.service_key   ?? "",
    qty:          r.qty           ?? 0,
    hours:        r.hours         ?? 0,
    holidayHours: r.holiday_hours ?? 0,
    travel:       r.travel        ?? 0,
    baseHourly:   r.base_hourly   ?? 0,
    baseDay:      r.base_day      ?? 0,
    otRate:       r.ot_rate       ?? 0,
    dtRate:       r.dt_rate       ?? 0,
    rule:         r.rule          ?? "",
    total:        r.total         ?? 0,
    positionId:   r.position_id   ?? undefined,
    specialtyId:  r.specialty_id  ?? undefined,
    department:   r.department    ?? undefined,
    specialty:    r.specialty     ?? undefined,
    shiftLabel:   r.shift_label   ?? undefined,
    quoteDate:    r.quote_date    ?? undefined,
    endDate:      r.end_date      ?? undefined,
    startTime:    r.start_time    ?? undefined,
    endTime:      r.end_time      ?? undefined,
    rateMode:     r.rate_mode     ?? undefined,
  };
}

/** Quote → row, restricted to columns mutable on a draft. The freeze trigger
 *  rejects writes to is_draft=false rows that touch any of these. */
function quoteToDraftRow(q: QuoteDraft) {
  return {
    id:                     q.id,
    client:                 q.client || null,
    client_id:              q.clientId || null,
    event_name:             q.eventName || null,
    venue:                  q.venue || null,
    city_state:             q.cityState || null,
    start_date:             q.startDate || null,
    end_date:               q.endDate || null,
    start_time:             q.startTime || null,
    end_time:               q.endTime || null,
    expected_hours_per_day: q.expectedHoursPerDay ?? null,
    total:                  q.total ?? 0,
    deposit:                q.deposit ?? 0,
    status:                 q.status,
    notes:                  q.notes || null,
    terms:                  q.terms || null,
    linked_job_request_id:  q.linkedJobRequestId || null,
    linked_job_sheet_id:    q.linkedJobSheetId || null,
    rate_card_profile_id:   q.rateCardProfileId || null,
    is_draft:               q.isDraft,
    job_request_id:         q.jobRequestId || null,
    parent_quote_id:        q.parentQuoteId || null,
    revision_no:            q.revisionNo ?? 1,
  };
}

function quoteLineToRow(quoteId: string, l: QuoteLine, index: number, existingId?: string) {
  return {
    id:            existingId ?? newLineId(),
    quote_id:      quoteId,
    sort_order:    index,
    service_key:   l.serviceKey,
    qty:           l.qty,
    hours:         l.hours,
    holiday_hours: l.holidayHours,
    travel:        l.travel,
    base_hourly:   l.baseHourly,
    base_day:      l.baseDay,
    ot_rate:       l.otRate,
    dt_rate:       l.dtRate,
    rule:          l.rule,
    total:         l.total,
    position_id:   l.positionId  ?? null,
    specialty_id:  l.specialtyId ?? null,
    department:    l.department  ?? null,
    specialty:     l.specialty   ?? null,
    shift_label:   l.shiftLabel  ?? null,
    quote_date:    l.quoteDate   ?? null,
    end_date:      l.endDate     ?? null,
    start_time:    l.startTime   ?? null,
    end_time:      l.endTime     ?? null,
    rate_mode:     l.rateMode    ?? null,
  };
}

// ─── Read operations ─────────────────────────────────────────────────────────

export type QuoteFilters = {
  jobRequestId?: string;
  clientId?: string;
  isDraft?: boolean;
  /** Hide superseded rows (default true). */
  hideSuperseded?: boolean;
};

/** Load quotes (drafts + frozen) with optional filters. Lines NOT included —
 *  use loadQuote(id) when you need the full document. */
export async function loadQuotes(filters: QuoteFilters = {}): Promise<QuoteDraft[]> {
  let q = supabase.from("quotes").select("*");

  if (filters.jobRequestId) q = q.eq("job_request_id", filters.jobRequestId);
  if (filters.clientId)     q = q.eq("client_id", filters.clientId);
  if (filters.isDraft !== undefined) q = q.eq("is_draft", filters.isDraft);
  if (filters.hideSuperseded !== false) q = q.or("status.is.null,status.neq.superseded");

  q = q.order("updated_at", { ascending: false });

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => rowToQuote(r));
}

/** Load a single quote with its lines. */
export async function loadQuote(id: string): Promise<QuoteDraft | null> {
  const [quoteRes, linesRes] = await Promise.all([
    supabase.from("quotes").select("*").eq("id", id).maybeSingle(),
    supabase.from("quote_lines").select("*").eq("quote_id", id).order("sort_order"),
  ]);
  if (quoteRes.error) throw quoteRes.error;
  if (linesRes.error) throw linesRes.error;
  if (!quoteRes.data) return null;
  return rowToQuote(quoteRes.data, linesRes.data ?? []);
}

// ─── Rate card selection ─────────────────────────────────────────────────────

/** Pick the rate card profile effective for the given client + job start date.
 *  Most recent client-specific card whose effective_date is <= job start; falls
 *  back to master default filtered the same way. */
export async function pickRateCardForJob(
  clientId: string | null | undefined,
  jobStartDate: string,
): Promise<{ id: string; rows: any[] } | null> {
  // 1. Try client-specific card
  if (clientId) {
    const r = await supabase
      .from("rate_card_profiles")
      .select("*")
      .eq("client_id", clientId)
      .lte("effective_date", jobStartDate)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r.error) throw r.error;
    if (r.data) {
      const rows = await loadRateCardRows(r.data.id);
      return { id: r.data.id, rows };
    }
  }
  // 2. Master default
  const m = await supabase
    .from("rate_card_profiles")
    .select("*")
    .eq("id", "ratecard-master-default")
    .lte("effective_date", jobStartDate)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (m.error) throw m.error;
  if (!m.data) return null;
  const rows = await loadRateCardRows(m.data.id);
  return { id: m.data.id, rows };
}

async function loadRateCardRows(profileId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("rate_card_profile_rows")
    .select("*")
    .eq("profile_id", profileId)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

// ─── Write operations ────────────────────────────────────────────────────────

/** Create a new draft from a job_request. Picks the appropriate rate card by
 *  effective date, seeds lines from crew_needs if any exist, otherwise from
 *  the rate card on day 1 only (multi-day jobs let user "Copy from Day N-1"). */
export async function createDraftFromJob(jobRequestId: string): Promise<QuoteDraft> {
  // Load the job, its days, and any crew needs.
  const jobRes = await supabase.from("job_requests").select("*").eq("id", jobRequestId).maybeSingle();
  if (jobRes.error) throw jobRes.error;
  if (!jobRes.data) throw new Error(`Job request not found: ${jobRequestId}`);
  const job = jobRes.data;

  const daysRes = await supabase
    .from("job_request_days")
    .select("*")
    .eq("job_request_id", jobRequestId)
    .order("sort_order");
  if (daysRes.error) throw daysRes.error;
  const days = daysRes.data ?? [];
  // Fall back to a synthetic single-day if no day rows exist.
  const effectiveDays = days.length > 0
    ? days
    : [{
        id: `${jobRequestId}-virtual-day-0`,
        event_date: job.request_date,
        start_time: job.start_time,
        end_time: job.end_time,
      }];

  let crewNeeds: any[] = [];
  if (days.length > 0) {
    const dayIds = days.map((d: any) => d.id);
    const cnRes = await supabase
      .from("job_request_crew_needs")
      .select("*")
      .in("job_request_day_id", dayIds);
    if (cnRes.error) throw cnRes.error;
    crewNeeds = cnRes.data ?? [];
  }

  const rateCard = await pickRateCardForJob(job.client_id, job.request_date);
  if (!rateCard) {
    throw new Error("No applicable rate card found (no client card, no master default).");
  }

  const draftId = newQuoteId();
  const draft: QuoteDraft = {
    id: draftId,
    clientId: job.client_id ?? undefined,
    client: "",
    eventName: "",
    venue: "",
    cityState: "",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    total: 0,
    deposit: 0,
    status: null,
    notes: "",
    terms: "",
    lines: [],
    isDraft: true,
    jobRequestId: jobRequestId,
    linkedJobRequestId: jobRequestId,
    revisionNo: 1,
    rateCardProfileId: rateCard.id,
  };

  // Seed lines.
  if (crewNeeds.length > 0) {
    // Crew-needs path: only positions actually scoped on the job
    for (const day of effectiveDays) {
      const needs = crewNeeds.filter((n: any) => n.job_request_day_id === day.id);
      for (const need of needs) {
        const rate = rateCard.rows.find(
          (rr: any) =>
            rr.position_id === need.position_id &&
            (rr.specialty_id ?? null) === (need.specialty_id ?? null),
        );
        draft.lines.push(buildLineFromRate(rate, {
          qty: need.quantity,
          quoteDate: day.event_date,
          startTime: day.start_time,
          endTime: day.end_time,
          positionId: need.position_id,
          specialtyId: need.specialty_id,
        }));
      }
    }
  } else {
    // No crew needs: seed day 1 with full rate card. Days 2+ stay empty until
    // the user uses the "Copy from Day N-1" button in the UI.
    const day1 = effectiveDays[0];
    for (const rr of rateCard.rows) {
      draft.lines.push(buildLineFromRate(rr, {
        qty: 0,
        quoteDate: day1.event_date,
        startTime: day1.start_time,
        endTime: day1.end_time,
        positionId: rr.position_id,
        specialtyId: rr.specialty_id,
      }));
    }
  }

  await persistDraft(draft);
  return draft;
}

/** Create a new draft as a revision of an existing frozen quote. Carries forward
 *  lines verbatim (preserving the parent's snapshot rates — revision is a tweak,
 *  not a reprice). */
export async function createDraftFromRevision(parentQuoteId: string): Promise<QuoteDraft> {
  const parent = await loadQuote(parentQuoteId);
  if (!parent) throw new Error(`Parent quote not found: ${parentQuoteId}`);
  if (parent.isDraft) throw new Error(`Cannot revise a draft quote (id=${parentQuoteId})`);

  const draftId = newQuoteId();
  const draft: QuoteDraft = {
    ...parent,
    id: draftId,
    isDraft: true,
    status: null,
    parentQuoteId: parent.id,
    quoteNo: undefined,
    revisionNo: parent.revisionNo + 1,
    issuedAt: undefined,
    issuedBy: undefined,
    supersededAt: undefined,
    supersededBy: undefined,
    signatureName: undefined,
    signedAt: undefined,
    signedBy: undefined,
    lines: parent.lines.map((l) => ({ ...l })),
  };

  await persistDraft(draft);
  return draft;
}

/** Save an in-progress draft. Throws if the row is frozen (defense-in-depth;
 *  the freeze trigger also blocks). */
export async function saveDraft(quote: QuoteDraft): Promise<void> {
  if (!quote.isDraft) {
    throw new Error(`Cannot saveDraft on a frozen quote (id=${quote.id}). Use Revise.`);
  }
  await persistDraft(quote);
}

async function persistDraft(quote: QuoteDraft): Promise<void> {
  // Upsert quote row
  const { error: qErr } = await supabase
    .from("quotes")
    .upsert(quoteToDraftRow(quote), { onConflict: "id" });
  if (qErr) throw qErr;

  // Replace lines: delete-then-insert is the simplest correct semantic for a
  // draft (line ordering and additions/removals are common). For drafts only —
  // frozen quote_lines are protected by the freeze trigger.
  const { error: delErr } = await supabase
    .from("quote_lines")
    .delete()
    .eq("quote_id", quote.id);
  if (delErr) throw delErr;

  if (quote.lines.length > 0) {
    const rows = quote.lines.map((l, i) => quoteLineToRow(quote.id, l, i));
    const { error: insErr } = await supabase.from("quote_lines").insert(rows);
    if (insErr) throw insErr;
  }
}

/** Issue a draft → frozen via the issue_quote_draft RPC. Snapshots event info,
 *  computes quote_no, advances job_request lead → quoted, supersedes parent
 *  on revisions. Returns the (now frozen) quote id. */
export async function issueDraft(quoteId: string): Promise<string> {
  const { data, error } = await supabase.rpc("issue_quote_draft", { p_quote_id: quoteId });
  if (error) throw error;
  return data as string;
}

/** Mark a frozen quote as signed. Only signature columns + status change —
 *  the freeze trigger lets these through. */
export async function markSigned(quoteId: string, signatureName: string): Promise<void> {
  const { error } = await supabase
    .from("quotes")
    .update({
      status: "signed",
      signature_name: signatureName,
      signed_at: new Date().toISOString(),
      // signed_by populated by auth.uid() server-side if we add a trigger; for
      // now leave null and let the audit trigger track updated_by.
    })
    .eq("id", quoteId)
    .eq("is_draft", false);
  if (error) throw error;
}

/** Delete a draft. Frozen quotes can't be deleted (freeze trigger blocks). */
export async function deleteDraft(quoteId: string): Promise<void> {
  const { error } = await supabase
    .from("quotes")
    .delete()
    .eq("id", quoteId)
    .eq("is_draft", true);
  if (error) throw error;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildLineFromRate(
  rate: any | undefined,
  opts: {
    qty: number;
    quoteDate?: string;
    startTime?: string;
    endTime?: string;
    positionId?: string;
    specialtyId?: string;
  },
): QuoteLine {
  return {
    serviceKey:   "",
    qty:          opts.qty,
    hours:        0,
    holidayHours: 0,
    travel:       0,
    baseHourly:   rate?.hourly  ?? 0,
    baseDay:      rate?.day     ?? 0,
    otRate:       rate?.ot_rate ?? 0,
    dtRate:       rate?.dt_rate ?? 0,
    rule:         rate?.rule_string ?? "",
    total:        0,
    positionId:   opts.positionId,
    specialtyId:  opts.specialtyId,
    quoteDate:    opts.quoteDate,
    startTime:    opts.startTime,
    endTime:      opts.endTime,
    rateMode:     rate?.rate_mode ?? "hourly",
  };
}

/** Display-status label for the unified list: Draft / Issued / Signed / Superseded. */
export function displayStatus(q: QuoteDraft): string {
  if (q.isDraft) return "Draft";
  if (!q.status) return "Issued"; // shouldn't happen given the CHECK, but safe fallback
  return q.status.charAt(0).toUpperCase() + q.status.slice(1);
}
