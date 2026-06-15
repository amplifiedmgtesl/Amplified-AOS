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
import {
  snapshotQuoteDaysFromJob,
  snapshotQuoteDaysFromParent,
} from "@/lib/storage/quote-days";

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
    total: r.total ?? 0,
    deposit: r.deposit ?? 0,
    depositPct: r.deposit_pct ?? undefined,
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
    holidayMultiplier: r.holiday_multiplier != null ? Number(r.holiday_multiplier) : 2.0,
    preparedByName: r.prepared_by_name ?? undefined,
    preparedByTitle: r.prepared_by_title ?? undefined,
    isDraft: r.is_draft ?? true,
    jobRequestId: r.job_request_id ?? undefined,
    parentQuoteId: r.parent_quote_id ?? undefined,
    quoteNo: r.quote_no ?? undefined,
    legacyQuoteNo: r.legacy_quote_no ?? undefined,
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
    crewCount:    r.crew_count    ?? r.qty ?? 1,
    hours:        r.hours         ?? 0,
    otHours:      r.ot_hours      ?? 0,
    dtHours:      r.dt_hours      ?? 0,
    travel:       r.travel        ?? 0,
    baseHourly:   r.base_hourly   ?? 0,
    baseDay:      r.base_day      ?? 0,
    otRate:       r.ot_rate       ?? 0,
    dtRate:       r.dt_rate       ?? 0,
    rule:         r.rule          ?? "",
    total:        r.total         ?? 0,
    specialtyId:  r.specialty_id  ?? undefined,
    shiftId:      r.shift_id      ?? undefined,
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
    total:                  q.total ?? 0,
    deposit:                q.deposit ?? 0,
    deposit_pct:            q.depositPct ?? null,
    status:                 q.status,
    notes:                  q.notes || null,
    terms:                  q.terms || null,
    linked_job_request_id:  q.linkedJobRequestId || null,
    linked_job_sheet_id:    q.linkedJobSheetId || null,
    rate_card_profile_id:   q.rateCardProfileId || null,
    holiday_multiplier:     q.holidayMultiplier ?? 2.0,
    prepared_by_name:       q.preparedByName || null,
    prepared_by_title:      q.preparedByTitle || null,
    is_draft:               q.isDraft,
    job_request_id:         q.jobRequestId || null,
    parent_quote_id:        q.parentQuoteId || null,
    revision_no:            q.revisionNo ?? 1,
  };
}

function quoteLineToRow(quoteId: string, l: QuoteLine, index: number, existingId?: string) {
  // Note: position_id, department, specialty are deprecated — display always
  // looks up via specialty_id FK. Dropped from the table by migration 20260505b.
  // qty is kept in sync with crewCount for backward compat.
  const crew = Number(l.crewCount ?? l.qty ?? 1);
  return {
    id:            existingId ?? newLineId(),
    quote_id:      quoteId,
    sort_order:    index,
    service_key:   l.serviceKey,
    qty:           crew,
    crew_count:    crew,
    hours:         l.hours,
    ot_hours:      l.otHours ?? 0,
    dt_hours:      l.dtHours ?? 0,
    travel:        l.travel,
    base_hourly:   l.baseHourly,
    base_day:      l.baseDay,
    ot_rate:       l.otRate,
    dt_rate:       l.dtRate,
    rule:          l.rule,
    total:         l.total,
    specialty_id:  l.specialtyId ?? null,
    shift_id:      l.shiftId     ?? null,
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

// ─── Active-quote resolution ─────────────────────────────────────────────────
// Single definition of "the quote for this job", shared by the job-screen
// Continue-Draft / View-Quote buttons (job-requests.tsx) and the crew-roster
// export. Keys on quotes.job_request_id (matches the existing button), newest
// first.

async function loadJobQuoteRows(jobRequestId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, is_draft, status, parent_quote_id, updated_at, revision_no, quote_no, event_name")
    .eq("job_request_id", jobRequestId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** The job-screen button's two-state view: the open draft (if any) and the
 *  latest issued, non-superseded quote (if any). Either may be null. */
export async function loadJobQuoteState(
  jobRequestId: string,
): Promise<{ openDraftId: string | null; latestIssuedId: string | null }> {
  const rows = await loadJobQuoteRows(jobRequestId);
  return {
    openDraftId: rows.find((r) => r.is_draft)?.id ?? null,
    latestIssuedId: rows.find((r) => !r.is_draft && r.status !== "superseded")?.id ?? null,
  };
}

/** The single "active" quote: the open draft if one exists, otherwise the
 *  latest issued non-superseded quote. Returns null if the job has no quote.
 *  `quoteNo` is the real assigned quote number, or null on drafts that don't
 *  have one yet — callers display the job's AES number in that case rather
 *  than the opaque row id. */
export async function resolveActiveQuoteForJob(
  jobRequestId: string,
): Promise<{ id: string; isDraft: boolean; revisionNo: number; quoteNo: string | null } | null> {
  const rows = await loadJobQuoteRows(jobRequestId);
  const chosen =
    rows.find((r) => r.is_draft) ??
    rows.find((r) => !r.is_draft && r.status !== "superseded");
  if (!chosen) return null;
  return {
    id: chosen.id,
    isDraft: !!chosen.is_draft,
    revisionNo: chosen.revision_no ?? 1,
    quoteNo: chosen.quote_no || null,
  };
}

// ─── Rate card selection ─────────────────────────────────────────────────────
// NOTE: these (pickRateCardForJob / resolveRateCardForJob) drive the QUOTE/INVOICE
// builders via the job_request pin + client/effective-date fallback. They are NOT
// the path the staff app mirrors — staff TIMESHEET pricing follows the timekeeping
// screen, which resolves the rate card from the job's most recent QUOTE. The synced
// copy lives at amplified-staff/lib/calc/rate-resolution.ts and is sourced from
// components/shared/timekeeping.tsx (job-meta useEffect), not from here.

/** Pick the rate card profile effective for the given client + job start date.
 *  Lookup order:
 *    1. Most recent client-specific card with effective_date <= jobStartDate
 *    2. Most recent client-specific card with NULL effective_date (legacy)
 *    3. Master default with effective_date <= jobStartDate
 *    4. Master default with NULL effective_date (legacy fallback)
 *    5. Any client-specific card (date-blind last resort)
 *    6. Master default (date-blind last resort)
 *  Returns null only if no rate card exists at all anywhere. */
export async function pickRateCardForJob(
  clientId: string | null | undefined,
  jobStartDate: string,
): Promise<{ id: string; rows: any[]; terms: string | null; holidayMultiplier: number } | null> {
  const wrap = async (data: any) => ({
    id: data.id,
    rows: await loadRateCardRows(data.id),
    terms: data.terms ?? null,
    holidayMultiplier: data.holiday_multiplier != null ? Number(data.holiday_multiplier) : 2.0,
  });
  // 1. Client-specific, effective on/before job
  if (clientId && jobStartDate) {
    const r = await supabase
      .from("rate_card_profiles")
      .select("*")
      .eq("client_id", clientId)
      .lte("effective_date", jobStartDate)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r.error) throw r.error;
    if (r.data) return wrap(r.data);
  }
  // 2. Client-specific, NULL effective_date (legacy)
  if (clientId) {
    const r = await supabase
      .from("rate_card_profiles")
      .select("*")
      .eq("client_id", clientId)
      .is("effective_date", null)
      .limit(1)
      .maybeSingle();
    if (r.error) throw r.error;
    if (r.data) return wrap(r.data);
  }
  // 3. Master default, effective on/before job
  if (jobStartDate) {
    const m = await supabase
      .from("rate_card_profiles")
      .select("*")
      .eq("id", "ratecard-master-default")
      .lte("effective_date", jobStartDate)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (m.error) throw m.error;
    if (m.data) return wrap(m.data);
  }
  // 4. Master default, NULL effective_date
  const m2 = await supabase
    .from("rate_card_profiles")
    .select("*")
    .eq("id", "ratecard-master-default")
    .is("effective_date", null)
    .limit(1)
    .maybeSingle();
  if (m2.error) throw m2.error;
  if (m2.data) return wrap(m2.data);

  // 5. Any client-specific card (date-blind)
  if (clientId) {
    const r = await supabase
      .from("rate_card_profiles")
      .select("*")
      .eq("client_id", clientId)
      .order("effective_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (r.error) throw r.error;
    if (r.data) return wrap(r.data);
  }
  // 6. Master default (date-blind)
  const m3 = await supabase
    .from("rate_card_profiles")
    .select("*")
    .eq("id", "ratecard-master-default")
    .limit(1)
    .maybeSingle();
  if (m3.error) throw m3.error;
  if (m3.data) return wrap(m3.data);

  return null;
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

/**
 * Resolve the rate card for a specific job_request. Honors the job's
 * `rate_card_profile_id` override (the pin) if set; otherwise falls back
 * to `pickRateCardForJob(client_id, request_date)`. Returns the same
 * shape as `pickRateCardForJob`. Lets other features (timekeeping,
 * job-costing) consume the exact same rate card the quote would.
 */
export async function resolveRateCardForJob(
  jobRequestId: string,
): Promise<{ id: string; rows: any[]; terms: string | null; holidayMultiplier: number } | null> {
  const jr = await supabase
    .from("job_requests")
    .select("client_id, request_date, rate_card_profile_id")
    .eq("id", jobRequestId)
    .maybeSingle();
  if (jr.error) throw jr.error;
  if (!jr.data) return null;
  const job = jr.data as any;

  // Pinned override wins.
  if (job.rate_card_profile_id) {
    const pinnedRes = await supabase
      .from("rate_card_profiles")
      .select("*")
      .eq("id", job.rate_card_profile_id)
      .maybeSingle();
    if (pinnedRes.error) throw pinnedRes.error;
    if (pinnedRes.data) {
      const rows = await loadRateCardRows(pinnedRes.data.id);
      return {
        id: pinnedRes.data.id,
        rows,
        terms: pinnedRes.data.terms ?? null,
        holidayMultiplier: pinnedRes.data.holiday_multiplier != null
          ? Number(pinnedRes.data.holiday_multiplier) : 2.0,
      };
    }
  }
  return pickRateCardForJob(job.client_id, job.request_date);
}

// ─── Write operations ────────────────────────────────────────────────────────

/** Shared line-seeding logic used by createDraftFromJob (initial seed) and
 *  reseedDraftLinesFromJob (re-sync after job edits). Reads the job + its
 *  days + crew_needs, resolves the right rate card, and returns the QuoteLines
 *  that should populate the draft. Doesn't touch the database directly. */
async function buildLinesFromJob(jobRequestId: string): Promise<{
  lines: QuoteLine[];
  rateCardId: string;
  holidayMultiplier: number;
  terms: string;
}> {
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
      .in("job_request_day_id", dayIds)
      .order("sort_order", { ascending: true });
    if (cnRes.error) throw cnRes.error;
    crewNeeds = cnRes.data ?? [];
  }

  const allPosIds = Array.from(new Set([
    ...crewNeeds.map((n: any) => n.position_id).filter(Boolean),
  ]));
  const allSpcIds = Array.from(new Set([
    ...crewNeeds.map((n: any) => n.specialty_id).filter(Boolean),
  ]));
  const [positionsRes, specialtiesRes] = await Promise.all([
    allPosIds.length > 0
      ? supabase.from("positions").select("id, name").in("id", allPosIds)
      : Promise.resolve({ data: [], error: null }),
    allSpcIds.length > 0
      ? supabase.from("specialties").select("id, name").in("id", allSpcIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const positionNameById = new Map<string, string>(
    (positionsRes.data ?? []).map((p: any) => [p.id, p.name]),
  );
  const specialtyNameById = new Map<string, string>(
    (specialtiesRes.data ?? []).map((s: any) => [s.id, s.name]),
  );

  let rateCard: { id: string; rows: any[]; terms: string | null; holidayMultiplier: number } | null = null;
  if (job.rate_card_profile_id) {
    const pinnedRes = await supabase
      .from("rate_card_profiles")
      .select("*")
      .eq("id", job.rate_card_profile_id)
      .maybeSingle();
    if (pinnedRes.error) throw pinnedRes.error;
    if (pinnedRes.data) {
      const rows = await loadRateCardRows(pinnedRes.data.id);
      rateCard = {
        id: pinnedRes.data.id,
        rows,
        terms: pinnedRes.data.terms ?? null,
        holidayMultiplier: pinnedRes.data.holiday_multiplier != null ? Number(pinnedRes.data.holiday_multiplier) : 2.0,
      };
    }
  }
  if (!rateCard) {
    rateCard = await pickRateCardForJob(job.client_id, job.request_date);
  }
  if (!rateCard) {
    throw new Error("No applicable rate card found (no client card, no master default).");
  }

  let terms = rateCard.terms || "";
  if (!terms) {
    const globalTerms = await supabase
      .from("app_rate_state")
      .select("value")
      .eq("key", "terms")
      .maybeSingle();
    terms = globalTerms.data?.value || "";
  }

  // Canonical (position, specialty) ordering: first-appearance across all days.
  // Ensures every day in the quote lists positions in the same sequence, even
  // when the job's per-day sort_order drifted (e.g. after duplicate-day).
  const canonicalKeyOrder = new Map<string, number>();
  for (const need of crewNeeds) {
    const key = `${need.position_id ?? ""}|${need.specialty_id ?? ""}`;
    if (!canonicalKeyOrder.has(key)) {
      canonicalKeyOrder.set(key, canonicalKeyOrder.size);
    }
  }

  const lines: QuoteLine[] = [];
  if (crewNeeds.length > 0) {
    for (const day of effectiveDays) {
      const needs = crewNeeds
        .filter((n: any) => n.job_request_day_id === day.id)
        .sort((a: any, b: any) => {
          const ka = `${a.position_id ?? ""}|${a.specialty_id ?? ""}`;
          const kb = `${b.position_id ?? ""}|${b.specialty_id ?? ""}`;
          return (canonicalKeyOrder.get(ka) ?? 999) - (canonicalKeyOrder.get(kb) ?? 999);
        });
      for (const need of needs) {
        const rate = need.specialty_id
          ? rateCard.rows.find((rr: any) => rr.specialty_id === need.specialty_id)
          : undefined;
        const hours = need.hours ?? day.expected_hours ?? 0;
        lines.push(buildLineFromRate(rate, {
          qty: need.quantity,
          hours,
          quoteDate: day.event_date,
          startTime: day.start_time,
          endTime: day.end_time,
          positionId: need.position_id,
          specialtyId: need.specialty_id,
          department: positionNameById.get(need.position_id) ?? undefined,
          specialty: specialtyNameById.get(need.specialty_id) ?? undefined,
        }));
      }
    }
  } else {
    const day1 = effectiveDays[0];
    for (const rr of rateCard.rows) {
      lines.push(buildLineFromRate(rr, {
        qty: 0,
        quoteDate: day1.event_date,
        startTime: day1.start_time,
        endTime: day1.end_time,
        positionId: rr.position_id,
        specialtyId: rr.specialty_id,
        department: rr.position ?? undefined,
        specialty: rr.specialty ?? undefined,
      }));
    }
  }

  return {
    lines,
    rateCardId: rateCard.id,
    holidayMultiplier: rateCard.holidayMultiplier,
    terms,
  };
}

/** Create a new draft from a job_request. Picks the appropriate rate card by
 *  effective date, seeds lines from crew_needs if any exist, otherwise from
 *  the rate card on day 1 only (multi-day jobs let user "Copy from Day N-1"). */
export async function createDraftFromJob(jobRequestId: string): Promise<QuoteDraft> {
  // Look up clientId quickly so the draft has it set before lines load.
  const jobLookup = await supabase
    .from("job_requests")
    .select("client_id")
    .eq("id", jobRequestId)
    .maybeSingle();
  if (jobLookup.error) throw jobLookup.error;
  if (!jobLookup.data) throw new Error(`Job request not found: ${jobRequestId}`);

  const seed = await buildLinesFromJob(jobRequestId);

  const draftId = newQuoteId();
  const draft: QuoteDraft = {
    id: draftId,
    clientId: jobLookup.data.client_id ?? undefined,
    client: "",
    eventName: "",
    venue: "",
    cityState: "",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    total: Math.round(seed.lines.reduce((s, l) => s + (l.total || 0), 0) * 100) / 100,
    deposit: Math.round(seed.lines.reduce((s, l) => s + (l.total || 0), 0) * 0.5 * 100) / 100,
    depositPct: 50,
    status: null,
    notes: "",
    terms: seed.terms,
    lines: seed.lines,
    isDraft: true,
    jobRequestId: jobRequestId,
    linkedJobRequestId: jobRequestId,
    revisionNo: 1,
    rateCardProfileId: seed.rateCardId,
    holidayMultiplier: seed.holidayMultiplier,
  };

  await persistDraft(draft);

  // Holiday Phase 2: snapshot job_request_days.is_holiday → quote_days so the
  // draft has its own editable holiday flags from the moment it's created.
  await snapshotQuoteDaysFromJob(draft.id, jobRequestId);

  return draft;
}

/** Re-seed a draft's lines from its linked job_request. Used when the job's
 *  crew_needs / days / pinned rate card have changed since the draft was
 *  initially created — e.g. client requested changes after a quote was
 *  drafted (or revised). Blows away all current lines and replaces them
 *  with the fresh seed; the holiday-day snapshot is also refreshed so any
 *  day-level changes on the job flow through.
 *
 *  Returns the refreshed draft plus a small summary so the UI can confirm
 *  what just happened.
 */
export type ReseedFromJobResult = {
  draft: QuoteDraft;
  previousLineCount: number;
  newLineCount: number;
  rateCardSwitched: boolean;
};

export async function reseedDraftLinesFromJob(draftId: string): Promise<ReseedFromJobResult> {
  const draft = await loadQuote(draftId);
  if (!draft) throw new Error(`Quote not found: ${draftId}`);
  if (!draft.isDraft) throw new Error(`Cannot reseed a frozen quote (id=${draftId}). Use Revise.`);
  if (!draft.jobRequestId) throw new Error(`Draft ${draftId} has no linked job_request.`);

  const previousLineCount = draft.lines.length;
  const previousRateCardId = draft.rateCardProfileId;

  const seed = await buildLinesFromJob(draft.jobRequestId);

  const refreshed: QuoteDraft = {
    ...draft,
    lines: seed.lines,
    total: Math.round(seed.lines.reduce((s, l) => s + (l.total || 0), 0) * 100) / 100,
    rateCardProfileId: seed.rateCardId,
    holidayMultiplier: seed.holidayMultiplier,
    // Terms: only adopt the seed terms if the draft's are empty, so we don't
    // overwrite operator edits to the terms block. Same conservative stance
    // as Revise.
    terms: draft.terms && draft.terms.trim() !== "" ? draft.terms : seed.terms,
  };

  await persistDraft(refreshed);

  // Refresh quote_days from job_request_days. Wipe-then-snapshot (rather
  // than upsert) so days that were REMOVED from the job don't leave stale
  // rows behind, and any holiday-flag changes on the job side propagate
  // cleanly. Safe on drafts — the quote_days freeze trigger only blocks
  // IUD when the parent quote is frozen, and we asserted isDraft above.
  const { error: delErr } = await supabase
    .from("quote_days")
    .delete()
    .eq("quote_id", refreshed.id);
  if (delErr) throw delErr;
  await snapshotQuoteDaysFromJob(refreshed.id, refreshed.jobRequestId);

  return {
    draft: refreshed,
    previousLineCount,
    newLineCount: seed.lines.length,
    rateCardSwitched: !!previousRateCardId && previousRateCardId !== seed.rateCardId,
  };
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

  // Holiday Phase 2: revisions inherit holiday flags from the parent quote's
  // quote_days snapshot so the revision's math starts identical to the
  // parent. User can re-toggle on the draft.
  await snapshotQuoteDaysFromParent(draft.id, parent.id);

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

/** Link a legacy orphan frozen quote (job_request_id IS NULL) to a job.
 *  Recomputes quote_no from the chosen job's job_no. One-time only — once
 *  linked, the freeze trigger blocks re-parenting. */
export async function linkOrphanQuote(quoteId: string, jobRequestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("link_orphan_quote", {
    p_quote_id: quoteId,
    p_job_request_id: jobRequestId,
  });
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
    hours?: number;
    quoteDate?: string;
    startTime?: string;
    endTime?: string;
    positionId?: string;
    specialtyId?: string;
    /** Resolved position/specialty names. Caller can pass these explicitly when
     *  there's no matching rate row to read them from (e.g. crew_needs that
     *  reference a position not in the rate card). */
    department?: string;
    specialty?: string;
  },
): QuoteLine {
  // Prefer explicitly-passed names; fall back to rate row's denormalized text.
  const department = opts.department ?? rate?.position ?? undefined;
  const specialty = opts.specialty ?? rate?.specialty ?? undefined;
  const hours = opts.hours ?? 0;
  // Recompute under the new explicit-OT/DT line model (2026-05-12).
  // Day mode: total = crew × baseDay. Hourly: total = (qty × hours) × baseHourly,
  // since `hours` in the new model is total person-hours not per-worker.
  const baseHourly = rate?.hourly ?? 0;
  const baseDay = rate?.day ?? 0;
  const isDayMode = rate?.rate_mode === "day" || (baseDay > 0 && hours === 0);
  const crewCount = opts.qty || 1;
  const totalPersonHours = isDayMode ? 0 : (opts.qty || 0) * hours;
  const rawTotal = isDayMode
    ? crewCount * baseDay
    : totalPersonHours * baseHourly;
  const total = Math.round(rawTotal * 100) / 100;
  return {
    serviceKey:   "",
    qty:          opts.qty,
    crewCount,
    hours:        totalPersonHours,
    otHours:      0,
    dtHours:      0,
    travel:       0,
    baseHourly:   rate?.hourly  ?? 0,
    baseDay:      rate?.day     ?? 0,
    otRate:       rate?.ot_rate ?? 0,
    dtRate:       rate?.dt_rate ?? 0,
    rule:         rate?.rule_string ?? "",
    total,
    positionId:   opts.positionId,
    specialtyId:  opts.specialtyId,
    department,
    specialty,
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
