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
    hours:        r.hours         ?? 0,
    holidayHours: r.holiday_hours ?? 0,
    travel:       r.travel        ?? 0,
    baseHourly:   r.base_hourly   ?? 0,
    baseDay:      r.base_day      ?? 0,
    otRate:       r.ot_rate       ?? 0,
    dtRate:       r.dt_rate       ?? 0,
    rule:         r.rule          ?? "",
    total:        r.total         ?? 0,
    specialtyId:  r.specialty_id  ?? undefined,
    department:   r.department    ?? undefined,
    specialty:    r.specialty     ?? undefined,
    shiftLabel:   r.shift_label   ?? undefined,
    quoteDate:    r.quote_date    ?? undefined,
    endDate:      r.end_date      ?? undefined,
    startTime:    r.start_time    ?? undefined,
    endTime:      r.end_time      ?? undefined,
    rateMode:     r.rate_mode     ?? undefined,
    sourceKind:   r.source_kind   ?? undefined,
    sourceQuoteLineId:      r.source_quote_line_id      ?? undefined,
    sourceTimesheetEntryId: r.source_timesheet_entry_id ?? undefined,
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
    linked_job_sheet_id:  inv.linkedJobSheetId || null,
    is_draft:            inv.isDraft,
    invoice_type:        inv.invoiceType ?? null,
    job_request_id:      inv.jobRequestId || null,
    source_quote_id:     inv.sourceQuoteId || null,
    parent_invoice_id:   inv.parentInvoiceId || null,
    covered_dates:       inv.coveredDates ?? null,
    revision_no:         inv.revisionNo ?? 1,
    deposit_applied:     inv.depositApplied ?? 0,
  };
}

function invoiceLineToRow(invoiceId: string, l: QuoteLine, index: number, existingId?: string) {
  return {
    id:            existingId ?? newLineId(),
    invoice_id:    invoiceId,
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
    specialty_id:  l.specialtyId ?? null,
    shift_label:   l.shiftLabel  ?? null,
    quote_date:    l.quoteDate   ?? null,
    end_date:      l.endDate     ?? null,
    start_time:    l.startTime   ?? null,
    end_time:      l.endTime     ?? null,
    rate_mode:     l.rateMode    ?? null,
    source_kind:   l.sourceKind             ?? null,
    source_quote_line_id:      l.sourceQuoteLineId      ?? null,
    source_timesheet_entry_id: l.sourceTimesheetEntryId ?? null,
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

  // Compute deposit credit available for this job
  const depositInvRes = await supabase
    .from("invoices")
    .select("deposit, paid_amount")
    .eq("job_request_id", q.job_request_id)
    .eq("invoice_type", "deposit")
    .or("status.is.null,and(status.neq.superseded,status.neq.void)");
  const depositPaid = (depositInvRes.data ?? []).reduce((s: number, r: any) => s + (r.paid_amount ?? 0), 0);

  const finalsAppliedRes = await supabase
    .from("invoices")
    .select("deposit_applied")
    .eq("job_request_id", q.job_request_id)
    .eq("invoice_type", "final")
    .or("status.is.null,and(status.neq.superseded,status.neq.void)");
  const alreadyApplied = (finalsAppliedRes.data ?? []).reduce((s: number, r: any) => s + (r.deposit_applied ?? 0), 0);

  const depositCreditAvailable = Math.max(0, depositPaid - alreadyApplied);
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
      hours: ql.hours ?? 0,
      holidayHours: ql.holiday_hours ?? 0,
      travel: ql.travel ?? 0,
      baseHourly: ql.base_hourly ?? 0,
      baseDay: ql.base_day ?? 0,
      otRate: ql.ot_rate ?? 0,
      dtRate: ql.dt_rate ?? 0,
      rule: ql.rule ?? "",
      total: ql.total ?? 0,
      specialtyId: ql.specialty_id ?? undefined,
      shiftLabel: ql.shift_label ?? undefined,
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
  return draft;
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

/** Mark as paid (manually — usually triggered automatically when amount_paid
 *  reaches balance). */
export async function markPaid(invoiceId: string): Promise<void> {
  const { error } = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
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
