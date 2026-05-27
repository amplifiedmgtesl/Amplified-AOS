/**
 * lib/store/invoices.ts
 *
 * Single source of truth for invoice operations after the Phase C rewrite.
 * Mirrors the lib/store/quotes.ts pattern: async, direct to Supabase, no
 * fire-and-forget cache writes. The freeze trigger on the DB is the structural
 * backstop — any code path that tries to mutate a frozen invoice gets a clean
 * DB error.
 *
 * Companion: docs/invoice-rewrite-plan.md
 */

import { supabase } from "@/lib/supabase/client";
import type { InvoiceDraft, QuoteLine, QuoteDraft } from "./types";
import {
  snapshotInvoiceDaysFromQuote,
  snapshotInvoiceDaysFromJob,
  snapshotInvoiceDaysFromParent,
  upsertInvoiceDay,
} from "@/lib/storage/invoice-days";

function newInvoiceId(): string {
  return `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newLineId(): string {
  return `il-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Row ↔ Object conversion ─────────────────────────────────────────────────

function rowToInvoice(r: any, lineRows: any[] = []): InvoiceDraft {
  return {
    id: r.id,
    quoteId: r.quote_id ?? "",
    invoiceNo: r.invoice_no ?? "",
    issueDate: r.issue_date ?? "",
    dueDate: r.due_date ?? "",
    poNo: r.po_no ?? "",
    billTo: r.bill_to ?? "",
    clientId: r.client_id ?? undefined,
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    cityState: r.city_state ?? "",
    lines: lineRows.map(rowToInvoiceLine),
    subtotal: r.subtotal ?? 0,
    deposit: r.deposit ?? 0,
    amountDue: r.amount_due ?? 0,
    terms: r.terms ?? "",
    notes: r.notes ?? "",
    status: r.status ?? null,
    paidAmount: r.paid_amount ?? 0,
    rateCardProfileId: r.rate_card_profile_id ?? undefined,
    holidayMultiplier: r.holiday_multiplier != null ? Number(r.holiday_multiplier) : 2.0,
    linkedJobSheetId: r.linked_job_sheet_id ?? undefined,
    timesheetSummary: r.timesheet_summary ?? undefined,
    isDraft: r.is_draft ?? true,
    invoiceType: r.invoice_type ?? undefined,
    jobRequestId: r.job_request_id ?? undefined,
    sourceQuoteId: r.source_quote_id ?? undefined,
    sourceQuoteCode: r.source_quote_code ?? undefined,
    parentInvoiceId: r.parent_invoice_id ?? undefined,
    coveredDates: r.covered_dates ?? undefined,
    revisionNo: r.revision_no ?? 1,
    depositApplied: r.deposit_applied ?? 0,
    creditsApplied: r.credits_applied ?? 0,
    issuedAt: r.issued_at ?? undefined,
    issuedBy: r.issued_by ?? undefined,
    sentAt: r.sent_at ?? undefined,
    sentBy: r.sent_by ?? undefined,
    paidAt: r.paid_at ?? undefined,
    paidBy: r.paid_by ?? undefined,
    supersededAt: r.superseded_at ?? undefined,
    supersededBy: r.superseded_by ?? undefined,
    voidedAt: r.voided_at ?? undefined,
    voidedBy: r.voided_by ?? undefined,
    voidReason: r.void_reason ?? undefined,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    updatedBy: r.updated_by ?? undefined,
  };
}

function rowToInvoiceLine(r: any): QuoteLine {
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
    positionId:   r.position_id   ?? undefined,
    specialtyId:  r.specialty_id  ?? undefined,
    department:   r.department    ?? undefined,
    specialty:    r.specialty     ?? undefined,
    shiftId:      r.shift_id      ?? undefined,
    quoteDate:    r.quote_date    ?? undefined,
    endDate:      r.end_date      ?? undefined,
    startTime:    r.start_time    ?? undefined,
    endTime:      r.end_time      ?? undefined,
    rateMode:     r.rate_mode     ?? undefined,
    sourceKind:   r.source_kind   ?? undefined,
    sourceQuoteLineId:      r.source_quote_line_id      ?? undefined,
  };
}

/** Invoice → row, restricted to columns mutable on a draft. The freeze
 *  trigger rejects writes to is_draft=false rows that touch any of these. */
function invoiceToDraftRow(inv: InvoiceDraft) {
  return {
    id:                  inv.id,
    quote_id:            inv.quoteId || null,
    issue_date:          inv.issueDate || null,
    due_date:            inv.dueDate || null,
    po_no:               inv.poNo || null,
    bill_to:             inv.billTo || null,
    client:              inv.client || null,
    client_id:           inv.clientId || null,
    event_name:          inv.eventName || null,
    venue:               inv.venue || null,
    city_state:          inv.cityState || null,
    subtotal:            inv.subtotal ?? 0,
    deposit:             inv.deposit ?? 0,
    amount_due:          inv.amountDue ?? 0,
    terms:               inv.terms || null,
    notes:               inv.notes || null,
    status:              inv.status,
    rate_card_profile_id: inv.rateCardProfileId || null,
    holiday_multiplier:   inv.holidayMultiplier ?? 2.0,
    linked_job_sheet_id:  inv.linkedJobSheetId || null,
    is_draft:            inv.isDraft,
    invoice_type:        inv.invoiceType ?? null,
    job_request_id:      inv.jobRequestId || null,
    source_quote_id:     inv.sourceQuoteId || null,
    // Snapshot the source quote's quote_no on the draft so the editor and
    // list can show "Source quote: AES_..._EST_REV2" before issue. The
    // issue_invoice_draft RPC reasserts this on freeze (so a quote_no edit
    // after the draft was created gets picked up at issue time), but the
    // draft needs it persisted now or it'd display as "—" until issued.
    source_quote_code:   inv.sourceQuoteCode || null,
    parent_invoice_id:   inv.parentInvoiceId || null,
    covered_dates:       inv.coveredDates ?? null,
    revision_no:         inv.revisionNo ?? 1,
    deposit_applied:     inv.depositApplied ?? 0,
  };
}

function invoiceLineToRow(invoiceId: string, l: QuoteLine, index: number, existingId?: string) {
  // Keep legacy qty in sync with crewCount so any code path still reading
  // qty (legacy invoice-builder, exports, audit) stays correct.
  const crew = Number(l.crewCount ?? l.qty ?? 1);
  return {
    id:            existingId ?? newLineId(),
    invoice_id:    invoiceId,
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
    position_id:   l.positionId ?? null,
    specialty_id:  l.specialtyId ?? null,
    department:    l.department  ?? null,
    specialty:     l.specialty   ?? null,
    shift_id:      l.shiftId     ?? null,
    quote_date:    l.quoteDate   ?? null,
    end_date:      l.endDate     ?? null,
    start_time:    l.startTime   ?? null,
    end_time:      l.endTime     ?? null,
    rate_mode:     l.rateMode    ?? null,
    source_kind:   l.sourceKind             ?? null,
    source_quote_line_id:      l.sourceQuoteLineId      ?? null,
  };
}

// ─── Read operations ─────────────────────────────────────────────────────────

export type InvoiceFilters = {
  jobRequestId?: string;
  clientId?: string;
  sourceQuoteId?: string;
  isDraft?: boolean;
  /** Hide superseded + voided rows (default true). */
  hideSupersededAndVoid?: boolean;
};

export async function loadInvoices(filters: InvoiceFilters = {}): Promise<InvoiceDraft[]> {
  let q = supabase.from("invoices").select("*");
  if (filters.jobRequestId)  q = q.eq("job_request_id", filters.jobRequestId);
  if (filters.clientId)      q = q.eq("client_id", filters.clientId);
  if (filters.sourceQuoteId) q = q.eq("source_quote_id", filters.sourceQuoteId);
  if (filters.isDraft !== undefined) q = q.eq("is_draft", filters.isDraft);
  if (filters.hideSupersededAndVoid !== false) {
    q = q.or("status.is.null,and(status.neq.superseded,status.neq.void)");
  }
  q = q.order("updated_at", { ascending: false });

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => rowToInvoice(r));
}

export async function loadInvoice(id: string): Promise<InvoiceDraft | null> {
  const [invRes, linesRes] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sort_order"),
  ]);
  if (invRes.error) throw invRes.error;
  if (linesRes.error) throw linesRes.error;
  if (!invRes.data) return null;
  return rowToInvoice(invRes.data, linesRes.data ?? []);
}

// ─── Already-billed quote_line ids (for re-invoicing prevention) ─────────────
export async function getAlreadyBilledQuoteLineIds(jobRequestId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("invoice_lines")
    .select("source_quote_line_id, invoices!inner(job_request_id, status)")
    .eq("invoices.job_request_id", jobRequestId)
    .or("status.is.null,and(status.neq.superseded,status.neq.void)", { foreignTable: "invoices" })
    .not("source_quote_line_id", "is", null);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.source_quote_line_id));
}

// ─── Already-billed timesheet_entry ids (for re-invoicing prevention) ────────
// An entry is "already billed" when its invoice_line_id points at a line
// whose parent invoice is non-superseded and non-void. Voided/superseded
// invoice lines effectively release the entry back to the pool.
export async function getAlreadyBilledTimesheetEntryIds(jobRequestId: string): Promise<Set<string>> {
  // 1. Find timesheets for this job (timesheet.job_sheet_id OR via job_id when
  //    the schema is migrated; use whichever links exist now).
  // 2. Their entries.
  // 3. Filter to entries whose invoice_line_id resolves to an active invoice.
  const { data, error } = await supabase
    .from("timesheet_entries")
    .select("id, invoice_line_id, invoice_lines!inner(invoice_id, invoices!inner(job_request_id, status))")
    .eq("invoice_lines.invoices.job_request_id", jobRequestId)
    .or("status.is.null,and(status.neq.superseded,status.neq.void)", { foreignTable: "invoice_lines.invoices" })
    .not("invoice_line_id", "is", null);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.id));
}

// ─── Write operations ────────────────────────────────────────────────────────

/** Create a deposit-invoice draft from a frozen quote.
 *
 *  Deposits have NO line items. The deposit is a lump-sum amount stored on
 *  the invoice header (subtotal = depositAmount). The PDF and detail views
 *  render a synthesized "Deposit for {quote_no}" line at display time so
 *  the customer sees a meaningful description without the data shape having
 *  to fake a line item with the amount stuffed into a wrong field.
 */
export async function createDepositDraftFromQuote(quoteId: string): Promise<InvoiceDraft> {
  const qRes = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (qRes.error) throw qRes.error;
  if (!qRes.data) throw new Error(`Quote not found: ${quoteId}`);
  const q = qRes.data;
  if (q.is_draft) throw new Error(`Cannot generate invoice from a draft quote (${quoteId}). Issue it first.`);
  if (!q.job_request_id) throw new Error(`Quote ${quoteId} has no linked job_request.`);

  const depositAmount = Math.round(((q.total ?? 0) * ((q.deposit_pct ?? 0) / 100)) * 100) / 100;

  const draftId = newInvoiceId();
  const draft: InvoiceDraft = {
    id: draftId,
    quoteId: q.id,
    invoiceNo: "",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    poNo: "",
    billTo: q.client ?? "",
    clientId: q.client_id ?? undefined,
    client: q.client ?? "",
    eventName: q.event_name ?? "",
    venue: q.venue ?? "",
    cityState: q.city_state ?? "",
    lines: [],                          // Deposits have no line items by design
    subtotal: depositAmount,            // The lump-sum deposit amount
    deposit: depositAmount,             // Legacy field kept in sync
    amountDue: depositAmount,
    terms: q.terms ?? "",
    notes: "",
    status: null,
    paidAmount: 0,
    rateCardProfileId: q.rate_card_profile_id ?? undefined,
    holidayMultiplier: q.holiday_multiplier != null ? Number(q.holiday_multiplier) : 2.0,
    isDraft: true,
    invoiceType: "deposit",
    jobRequestId: q.job_request_id,
    sourceQuoteId: q.id,
    sourceQuoteCode: q.quote_no ?? undefined,
    revisionNo: 1,
    depositApplied: 0,
    creditsApplied: 0,
  };

  await persistDraft(draft);

  // Holiday Phase 3: seed invoice_days from source quote's quote_days.
  // Deposits don't have line items so the holiday flag has no calc impact,
  // but the rows are still useful as a Revise/audit anchor.
  await snapshotInvoiceDaysFromQuote(draft.id, q.id);

  return draft;
}

/** Create a final-invoice draft from a frozen quote. Optionally scope to
 *  specific covered dates (per-day final). Excludes already-billed
 *  quote_lines. */
export async function createFinalDraftFromQuote(
  quoteId: string,
  opts: { coveredDates?: string[] } = {},
): Promise<InvoiceDraft> {
  const qRes = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (qRes.error) throw qRes.error;
  if (!qRes.data) throw new Error(`Quote not found: ${quoteId}`);
  const q = qRes.data;
  if (q.is_draft) throw new Error(`Cannot generate invoice from a draft quote (${quoteId}). Issue it first.`);
  if (!q.job_request_id) throw new Error(`Quote ${quoteId} has no linked job_request.`);

  const linesRes = await supabase.from("quote_lines").select("*").eq("quote_id", quoteId).order("sort_order");
  if (linesRes.error) throw linesRes.error;
  let quoteLines = linesRes.data ?? [];

  // Filter to covered dates if specified
  if (opts.coveredDates && opts.coveredDates.length > 0) {
    const dateSet = new Set(opts.coveredDates);
    quoteLines = quoteLines.filter((l: any) => l.quote_date && dateSet.has(l.quote_date));
  }

  // Exclude already-billed quote_lines (anywhere on a non-superseded/void invoice for this job)
  const alreadyBilled = await getAlreadyBilledQuoteLineIds(q.job_request_id);
  quoteLines = quoteLines.filter((l: any) => !alreadyBilled.has(l.id));

  const subtotal = Math.round(quoteLines.reduce((s: number, l: any) => s + (l.total || 0), 0) * 100) / 100;

  // Compute deposit credit available for this job.
  //
  // Deposit credit = deposit invoice's subtotal (the BILLED amount), not its
  // paid_amount. The deposit and final are separate invoices for the same
  // engagement; the customer owes (deposit) + (final − deposit applied) =
  // (full job total) regardless of when they pay either one. Tying credit
  // to paid_amount would mis-state the final's balance due whenever the
  // customer hasn't paid the deposit yet — they'd appear to owe the full
  // job total on the final, double-counting the deposit invoice.
  const depositInvRes = await supabase
    .from("invoices")
    .select("subtotal, paid_amount")
    .eq("job_request_id", q.job_request_id)
    .eq("invoice_type", "deposit")
    .or("status.is.null,and(status.neq.superseded,status.neq.void)");
  const depositBilled = (depositInvRes.data ?? []).reduce((s: number, r: any) => s + (r.subtotal ?? 0), 0);

  const finalsAppliedRes = await supabase
    .from("invoices")
    .select("deposit_applied")
    .eq("job_request_id", q.job_request_id)
    .eq("invoice_type", "final")
    .or("status.is.null,and(status.neq.superseded,status.neq.void)");
  const alreadyApplied = (finalsAppliedRes.data ?? []).reduce((s: number, r: any) => s + (r.deposit_applied ?? 0), 0);

  const depositCreditAvailable = Math.max(0, depositBilled - alreadyApplied);
  const depositApplied = Math.min(depositCreditAvailable, subtotal);

  const draftId = newInvoiceId();
  const draft: InvoiceDraft = {
    id: draftId,
    quoteId: q.id,
    invoiceNo: "",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    poNo: "",
    billTo: q.client ?? "",
    clientId: q.client_id ?? undefined,
    client: q.client ?? "",
    eventName: q.event_name ?? "",
    venue: q.venue ?? "",
    cityState: q.city_state ?? "",
    lines: quoteLines.map((ql: any) => ({
      serviceKey: ql.service_key ?? "",
      qty: ql.qty ?? 0,
      crewCount: ql.crew_count ?? ql.qty ?? 1,
      hours: ql.hours ?? 0,
      otHours: ql.ot_hours ?? 0,
      dtHours: ql.dt_hours ?? 0,
      travel: ql.travel ?? 0,
      baseHourly: ql.base_hourly ?? 0,
      baseDay: ql.base_day ?? 0,
      otRate: ql.ot_rate ?? 0,
      dtRate: ql.dt_rate ?? 0,
      rule: ql.rule ?? "",
      total: ql.total ?? 0,
      specialtyId: ql.specialty_id ?? undefined,
      shiftId:    ql.shift_id     ?? undefined,
      quoteDate: ql.quote_date ?? undefined,
      endDate: ql.end_date ?? undefined,
      startTime: ql.start_time ?? undefined,
      endTime: ql.end_time ?? undefined,
      rateMode: ql.rate_mode ?? undefined,
      sourceKind: "quote_line",
      sourceQuoteLineId: ql.id,
    })),
    subtotal,
    deposit: 0,
    amountDue: subtotal - depositApplied,
    terms: q.terms ?? "",
    notes: "",
    status: null,
    paidAmount: 0,
    rateCardProfileId: q.rate_card_profile_id ?? undefined,
    holidayMultiplier: q.holiday_multiplier != null ? Number(q.holiday_multiplier) : 2.0,
    isDraft: true,
    invoiceType: "final",
    jobRequestId: q.job_request_id,
    sourceQuoteId: q.id,
    sourceQuoteCode: q.quote_no ?? undefined,
    coveredDates: opts.coveredDates && opts.coveredDates.length > 0 ? opts.coveredDates : undefined,
    revisionNo: 1,
    depositApplied,
    creditsApplied: 0,
  };

  await persistDraft(draft);

  // Holiday Phase 3: snapshot invoice_days from source quote's quote_days so
  // line totals on this final invoice apply the same holiday treatment that
  // was in effect on the issued quote.
  await snapshotInvoiceDaysFromQuote(draft.id, q.id);

  return draft;
}

/** Overwrite a final-invoice draft's lines from approved timesheet entries.
 *
 *  Rewritten 2026-05-26 for the post-Phase-1..4 timekeeping world. Queries
 *  `timesheet_entries.job_id` directly (Phase 1) — the old job_sheets
 *  routing referenced a column that never existed and would throw. Groups
 *  by the canonical 5-tuple (work_date, position_id, specialty_id,
 *  shift_id, is_holiday) so each invoice line is uniquely keyed and the
 *  downstream calc engine doesn't merge incompatible rows.
 *
 *  Splits:
 *    * Different shifts on the same day → different lines (rate card may
 *      vary per shift; planning side already separates them).
 *    * Holiday vs non-holiday entries → different lines (multiplier rule
 *      vs ST/OT/DT split makes the calc semantics incompatible).
 *
 *  Carries forward: position_id, specialty_id, shift_id onto each line so
 *  the invoice retains the normalized identity. Legacy entries with NULL
 *  position_id (pre-Phase-3 stragglers) fall back to text-grouping by
 *  the legacy `position` column.
 *
 *  Side effect: ensures `invoice_days` has a row for every workDate in
 *  the pulled set with is_holiday matching the entry group. This keeps
 *  the invoice's holiday display + calc consistent with the source of
 *  truth on the timekeeping side.
 *
 *  Dedupe model (unchanged): an entry is "already billed" when its
 *  invoice_line_id resolves to a non-superseded / non-void invoice. Those
 *  are excluded. Entries currently pointing at THIS draft's own lines are
 *  re-included (the lines get replaced as part of the overwrite). The DB
 *  freeze trigger prevents status changes on invoice-bound entries, so
 *  by the time we get here the input set is internally consistent.
 *
 *  Throws if the invoice is frozen, not final, or has no jobRequestId.
 */
export async function overwriteFromTimesheets(
  invoiceId: string,
  opts: { coveredDates?: string[] } = {},
): Promise<InvoiceDraft> {
  const inv = await loadInvoice(invoiceId);
  if (!inv) throw new Error(`Invoice not found: ${invoiceId}`);
  if (!inv.isDraft) throw new Error(`Cannot overwrite a frozen invoice (id=${invoiceId}). Use Revise.`);
  if (inv.invoiceType !== "final") throw new Error(`Overwrite from timesheets is final-only (id=${invoiceId}, type=${inv.invoiceType ?? "null"}).`);
  if (!inv.jobRequestId) throw new Error(`Invoice ${invoiceId} has no linked job_request.`);

  // ─── 1. Approved entries for this job (via job_id — Phase 1 column) ────
  const entriesRes = await supabase
    .from("timesheet_entries")
    .select(`
      id, work_date, end_date,
      position, position_id, specialty_id, shift_id,
      employee_key,
      std_hours, ot_hours, dt_hours, total_hours,
      std_rate, ot_rate, dt_rate, total_pay,
      is_holiday, holiday_multiplier, invoice_line_id
    `)
    .eq("job_id", inv.jobRequestId)
    .eq("status", "approved");
  if (entriesRes.error) throw entriesRes.error;
  let entries = entriesRes.data ?? [];

  // ─── 2. coveredDates filter (optional) ────────────────────────────────
  if (opts.coveredDates && opts.coveredDates.length > 0) {
    const dateSet = new Set(opts.coveredDates);
    entries = entries.filter((e: any) => e.work_date && dateSet.has(e.work_date));
  }

  // ─── 3. Dedupe ─────────────────────────────────────────────────────────
  //   alreadyBilled = entries currently bound to active (non-superseded,
  //   non-void) invoices. ownEntryIds = entries currently bound to THIS
  //   draft's existing lines (they'll be replaced — re-include them).
  const alreadyBilled = await getAlreadyBilledTimesheetEntryIds(inv.jobRequestId);
  const ownLinesRes = await supabase
    .from("invoice_lines").select("id").eq("invoice_id", invoiceId);
  if (ownLinesRes.error) throw ownLinesRes.error;
  const ownLineIds = Array.from(new Set((ownLinesRes.data ?? []).map((r: any) => r.id)));
  const ownEntryIdsRes = await supabase
    .from("timesheet_entries").select("id")
    .in("invoice_line_id", ownLineIds.length > 0 ? ownLineIds : ["__none__"]);
  if (ownEntryIdsRes.error) throw ownEntryIdsRes.error;
  const ownEntryIds = new Set((ownEntryIdsRes.data ?? []).map((r: any) => r.id));
  entries = entries.filter((e: any) => !alreadyBilled.has(e.id) || ownEntryIds.has(e.id));

  // ─── 4. Group by the canonical 5-tuple ─────────────────────────────────
  //   (work_date, position_id-or-text, specialty_id, shift_id, is_holiday)
  //
  //   Each tuple becomes one invoice_line. Distinct employee count → crew_count.
  //   ST/OT/DT person-hours are summed (explicit per-worker totals — the
  //   timesheet calc already split them per the 8/12 cutoff or holiday rule).
  //   total_pay is summed too: it's a faithful sum of what we paid each
  //   contributing worker, including the holiday multiplier where applied.
  type Group = {
    workDate: string;
    endDate: string | null;
    positionId: string | null;
    positionText: string;       // for display + legacy fallback grouping
    specialtyId: string | null;
    shiftId: string | null;
    isHoliday: boolean;
    holidayMultiplier: number | null;
    stdHours: number;
    otHours: number;
    dtHours: number;
    stdRate: number;
    otRate: number;
    dtRate: number;
    totalPay: number;
    entryIds: string[];
    workerKeys: Set<string>;
  };
  const groups = new Map<string, Group>();
  for (const e of entries) {
    // Legacy entries with NULL position_id (25 stragglers on dev — "Crew",
    // "Fork Op") fall back to text-keyed grouping so they still aggregate
    // cleanly instead of every row becoming its own line.
    const posKey = e.position_id ? `pid:${e.position_id}` : `txt:${(e.position ?? "").trim().toLowerCase()}`;
    const key = [
      e.work_date ?? "",
      posKey,
      e.specialty_id ?? "",
      e.shift_id ?? "",
      e.is_holiday ? "h" : "n",
    ].join("|");
    const workerKey = e.employee_key ?? `entry-${e.id}`;
    const g = groups.get(key);
    if (g) {
      g.stdHours += Number(e.std_hours ?? 0);
      g.otHours  += Number(e.ot_hours  ?? 0);
      g.dtHours  += Number(e.dt_hours  ?? 0);
      g.totalPay += Number(e.total_pay ?? 0);
      g.entryIds.push(e.id);
      g.workerKeys.add(workerKey);
      if (e.end_date && (!g.endDate || e.end_date > g.endDate)) g.endDate = e.end_date;
    } else {
      groups.set(key, {
        workDate: e.work_date ?? "",
        endDate: e.end_date ?? null,
        positionId: e.position_id ?? null,
        positionText: e.position ?? "",
        specialtyId: e.specialty_id ?? null,
        shiftId: e.shift_id ?? null,
        isHoliday: !!e.is_holiday,
        holidayMultiplier: e.holiday_multiplier == null ? null : Number(e.holiday_multiplier),
        stdHours: Number(e.std_hours ?? 0),
        otHours:  Number(e.ot_hours  ?? 0),
        dtHours:  Number(e.dt_hours  ?? 0),
        stdRate:  Number(e.std_rate  ?? 0),
        otRate:   Number(e.ot_rate   ?? 0),
        dtRate:   Number(e.dt_rate   ?? 0),
        totalPay: Number(e.total_pay ?? 0),
        entryIds: [e.id],
        workerKeys: new Set([workerKey]),
      });
    }
  }

  // ─── 5. Build invoice lines ────────────────────────────────────────────
  //   Sort: date → shift → position text. Stable id assignment up front so
  //   we can back-link entries in one round-trip.
  const sorted = Array.from(groups.values()).sort((a, b) => {
    if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
    const aShift = a.shiftId ?? ""; const bShift = b.shiftId ?? "";
    if (aShift !== bShift) return aShift.localeCompare(bShift);
    return (a.positionText || "").localeCompare(b.positionText || "");
  });
  const lineIdByGroupIndex = sorted.map(() => newLineId());

  const newLines: QuoteLine[] = sorted.map((g) => {
    const crewCount = g.workerKeys.size;
    return {
      serviceKey: g.positionText,
      qty: crewCount,
      crewCount,
      hours:        +g.stdHours.toFixed(2),
      otHours:      +g.otHours.toFixed(2),
      dtHours:      +g.dtHours.toFixed(2),
      travel:       0,
      baseHourly:   g.stdRate,
      baseDay:      0,
      otRate:       g.otRate,
      dtRate:       g.dtRate,
      rule:         g.isHoliday ? "Holiday timesheet actuals" : "Timesheet actuals",
      total:        +g.totalPay.toFixed(2),
      positionId:   g.positionId ?? undefined,
      specialtyId:  g.specialtyId ?? undefined,
      specialty:    g.positionText,  // legacy display fallback
      shiftId:      g.shiftId ?? undefined,
      quoteDate:    g.workDate,
      endDate:      g.endDate ?? undefined,
      rateMode:     "hourly",
      sourceKind:   "timesheet_entry",
    };
  });

  const subtotal = +newLines.reduce((s, l) => s + (l.total || 0), 0).toFixed(2);

  // ─── 6. Sync invoice_days with the pulled holiday flags ────────────────
  //   The invoice's calc engine reads invoice_days to decide holiday
  //   treatment. Since we split holiday vs non-holiday into different
  //   lines, every group on a given date has a consistent isHoliday flag.
  //   Upsert one invoice_days row per distinct workDate.
  const dateHolidayMap = new Map<string, boolean>();
  for (const g of sorted) {
    if (!g.workDate) continue;
    // If somehow two groups for the same date have different flags (data
    // anomaly — entries on same date split on is_holiday), OR them so the
    // invoice flags the day as holiday. The freeze trigger on the
    // timekeeping side prevents this from happening in normal flow.
    const prior = dateHolidayMap.get(g.workDate);
    dateHolidayMap.set(g.workDate, !!prior || g.isHoliday);
  }
  for (const [date, isHol] of dateHolidayMap.entries()) {
    try {
      await upsertInvoiceDay({ invoiceId, invoiceDate: date, isHoliday: isHol });
    } catch (e) {
      // The freeze trigger on invoice_days blocks writes if the invoice
      // is frozen — but we already guard isDraft above. Any other failure
      // is logged but doesn't abort the pull (lines are still useful).
      console.error("[overwriteFromTimesheets] upsertInvoiceDay failed:", date, e);
    }
  }

  // ─── 7. Persist lines: delete existing → insert new → back-link entries ─
  // Delete existing draft lines (clears entry pointers via ON DELETE SET NULL).
  const { error: delErr } = await supabase
    .from("invoice_lines")
    .delete()
    .eq("invoice_id", invoiceId);
  if (delErr) throw delErr;

  if (newLines.length > 0) {
    const rows = newLines.map((l, i) => invoiceLineToRow(invoiceId, l, i, lineIdByGroupIndex[i]));
    const { error: insErr } = await supabase.from("invoice_lines").insert(rows);
    if (insErr) throw insErr;

    // Back-link entries → invoice_line_id
    // One UPDATE per group; entry counts are small (dozens at most).
    for (let i = 0; i < sorted.length; i++) {
      const lineId = lineIdByGroupIndex[i];
      const ids = sorted[i].entryIds;
      if (ids.length === 0) continue;
      const { error: linkErr } = await supabase
        .from("timesheet_entries")
        .update({ invoice_line_id: lineId })
        .in("id", ids);
      if (linkErr) throw linkErr;
    }
  }

  // 8. Update invoice header subtotal + amount_due
  const newAmountDue = +(subtotal - (inv.depositApplied ?? 0) - (inv.creditsApplied ?? 0)).toFixed(2);
  const { error: hdrErr } = await supabase
    .from("invoices")
    .update({ subtotal, amount_due: newAmountDue, updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("is_draft", true);
  if (hdrErr) throw hdrErr;

  const refreshed = await loadInvoice(invoiceId);
  if (!refreshed) throw new Error(`Invoice vanished after overwrite: ${invoiceId}`);
  return refreshed;
}

/** Save an in-progress draft. Throws if the row is frozen. */
export async function saveDraft(invoice: InvoiceDraft): Promise<void> {
  if (!invoice.isDraft) {
    throw new Error(`Cannot saveDraft on a frozen invoice (id=${invoice.id}). Use Revise.`);
  }
  await persistDraft(invoice);
}

async function persistDraft(invoice: InvoiceDraft): Promise<void> {
  const { error: invErr } = await supabase
    .from("invoices")
    .upsert(invoiceToDraftRow(invoice), { onConflict: "id" });
  if (invErr) throw invErr;

  // Replace lines: delete then insert. Drafts only — frozen lines protected by trigger.
  const { error: delErr } = await supabase
    .from("invoice_lines")
    .delete()
    .eq("invoice_id", invoice.id);
  if (delErr) throw delErr;

  if (invoice.lines.length > 0) {
    const rows = invoice.lines.map((l, i) => invoiceLineToRow(invoice.id, l, i));
    const { error: insErr } = await supabase.from("invoice_lines").insert(rows);
    if (insErr) throw insErr;
  }
}

/** Issue a draft → frozen via the issue_invoice_draft RPC. */
export async function issueDraft(invoiceId: string): Promise<string> {
  const { data, error } = await supabase.rpc("issue_invoice_draft", { p_invoice_id: invoiceId });
  if (error) throw error;
  return data as string;
}

/** Mark a frozen invoice as sent. Narrow status update; freeze trigger allows. */
export async function markSent(invoiceId: string): Promise<void> {
  const { error } = await supabase
    .from("invoices")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("is_draft", false);
  if (error) throw error;
}

/** Mark as paid manually — shorthand for "customer paid in full, I'm not
 *  recording the line-item payment right now."
 *
 *  Also bumps paid_amount to fully cover the balance so the denormalized
 *  aggregate stays consistent with status. The customer_payments + payment_
 *  allocations triggers normally maintain paid_amount, but this lets users
 *  close out an invoice without going through that flow. If they later
 *  record a real payment, the trigger will replace this manual value with
 *  the actual allocation total.
 */
export async function markPaid(invoiceId: string): Promise<void> {
  const inv = await loadInvoice(invoiceId);
  if (!inv) throw new Error(`Invoice not found: ${invoiceId}`);
  if (inv.isDraft) throw new Error(`Cannot mark a draft invoice paid (id=${invoiceId})`);

  const balance = Math.max(0, (inv.subtotal ?? 0) - (inv.depositApplied ?? 0) - (inv.creditsApplied ?? 0));
  const newPaidAmount = Math.max(inv.paidAmount ?? 0, balance);

  // Note: amount_due is blocked by the freeze trigger, but balanceDue() is
  // computed on the fly from subtotal − applied − credits − paid, so the
  // stored column doesn't drive any display. Skipping it here keeps the
  // update inside the freeze trigger's allow-list.
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_amount: newPaidAmount,
    })
    .eq("id", invoiceId)
    .eq("is_draft", false);
  if (error) throw error;
}

/** Void a frozen invoice. */
export async function voidInvoice(invoiceId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "void",
      voided_at: new Date().toISOString(),
      void_reason: reason,
    })
    .eq("id", invoiceId)
    .eq("is_draft", false);
  if (error) throw error;
}

/** Revise a frozen invoice → spawns a new draft with parent_invoice_id set. */
export async function reviseInvoice(invoiceId: string): Promise<InvoiceDraft> {
  const parent = await loadInvoice(invoiceId);
  if (!parent) throw new Error(`Invoice not found: ${invoiceId}`);
  if (parent.isDraft) throw new Error(`Cannot revise a draft invoice (id=${invoiceId})`);

  const draftId = newInvoiceId();
  const draft: InvoiceDraft = {
    ...parent,
    id: draftId,
    isDraft: true,
    status: null,
    parentInvoiceId: parent.id,
    invoiceNo: "",
    revisionNo: parent.revisionNo + 1,
    issuedAt: undefined,
    issuedBy: undefined,
    sentAt: undefined,
    sentBy: undefined,
    paidAt: undefined,
    paidBy: undefined,
    supersededAt: undefined,
    supersededBy: undefined,
    voidedAt: undefined,
    voidedBy: undefined,
    voidReason: undefined,
    paidAmount: 0,         // payments belong to the parent, not the revision
    creditsApplied: 0,
    lines: parent.lines.map((l) => ({ ...l })),
  };

  await persistDraft(draft);

  // Holiday Phase 3: revision inherits parent invoice's holiday flagging so
  // its line totals start identical to the parent. User can re-toggle.
  await snapshotInvoiceDaysFromParent(draft.id, parent.id);

  return draft;
}

/** Link a legacy orphan frozen invoice to a quote + job. */
export async function linkOrphanInvoice(
  invoiceId: string,
  sourceQuoteId: string,
  jobRequestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("link_orphan_invoice", {
    p_invoice_id: invoiceId,
    p_source_quote_id: sourceQuoteId,
    p_job_request_id: jobRequestId,
  });
  if (error) throw error;
  return data as string;
}

/** Delete a draft. Frozen invoices can't be deleted (freeze trigger blocks). */
export async function deleteDraft(invoiceId: string): Promise<void> {
  const { error } = await supabase
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("is_draft", true);
  if (error) throw error;
}

/** Display-status label for the unified list. */
export function displayStatus(inv: InvoiceDraft): string {
  if (inv.isDraft) return "Draft";
  if (!inv.status) return "Issued";
  return inv.status.charAt(0).toUpperCase() + inv.status.slice(1);
}

/** Compute balance due (subtotal − deposit_applied − credits_applied − amount_paid). */
export function balanceDue(inv: InvoiceDraft): number {
  return Math.round(((inv.subtotal ?? 0) - (inv.depositApplied ?? 0) - (inv.creditsApplied ?? 0) - (inv.paidAmount ?? 0)) * 100) / 100;
}
