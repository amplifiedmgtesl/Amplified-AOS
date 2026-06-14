
export type CalendarEvent = {
  id: string;
  source: string;
  clientId?: string;
  client: string;
  eventName: string;
  venue: string;
  venueAddress?: string;
  city?: string;
  state?: string;
  cityState: string;
  googleMapsLink?: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  status: string;
  lead?: string;
  hands?: string;
  linkedJobRequestId?: string;
};

export type QuoteLine = {
  serviceKey: string;
  /** Legacy qty field — kept in sync with crewCount for backward compat with
   *  any code path still reading qty. New code should read crewCount. */
  qty: number;
  /** Explicit worker count. Multiplier for baseDay on day-rate lines;
   *  informational only on hourly lines (hours is already total person-hours). */
  crewCount: number;
  /** Total ST person-hours. On day-rate lines this is 0 (day rate covers ST).
   *  On hourly lines this is the sum of all workers' ST hours. */
  hours: number;
  /** Total OT person-hours billed at otRate. Explicit since 2026-05-12 — was
   *  previously derived at calc time from rule + hours. */
  otHours: number;
  /** Total DT person-hours billed at dtRate. Explicit since 2026-05-12. */
  dtHours: number;
  travel: number;
  baseHourly: number;
  baseDay: number;
  otRate: number;
  dtRate: number;
  /** Informational only since 2026-05-12 — printed for the customer but no
   *  longer drives runtime calc. ST/OT/DT splits live in hours/otHours/dtHours. */
  rule: string;
  total: number;
  // FK references to positions/specialties master tables
  positionId?: string;
  specialtyId?: string;
  // Discrete UI columns (populated from quote_lines / invoice_lines table)
  department?: string;
  specialty?: string;
  /** FK to job_request_shifts. The free-text shiftLabel column was dropped
   *  in migration 20260512a — display lookup goes via the shifts list for
   *  the parent job_request. */
  shiftId?: string;
  quoteDate?: string;
  endDate?: string;      // optional end date for shifts that span multiple days
  startTime?: string;
  endTime?: string;
  rateMode?: string;
  // ─── Phase C invoice rewrite: source tracking on invoice_lines ──────────
  // These are only populated on lines that belong to an invoice (not a quote).
  // QuoteLine is the shared shape between quote_lines and invoice_lines tables.
  /** quote_line | timesheet_entry | manual_override — only on invoice_lines. */
  sourceKind?: "quote_line" | "timesheet_entry" | "manual_override";
  /** FK to the originating quote_lines row. Prevents double-billing. */
  sourceQuoteLineId?: string;
  // Timesheet→invoice linkage flipped 2026-05-10: timesheet_entries now have
  // an invoice_line_id back-reference (handles many-to-one aggregation).
  // The per-line sourceTimesheetEntryId field was dropped.
  /** invoice_lines row id. Stable across draft saves (2026-06-11) so the
   *  timesheet_entries.invoice_line_id back-links survive editing — the old
   *  delete-all/reinsert save path regenerated ids and severed them. Only
   *  populated on lines loaded from / persisted to invoice_lines. */
  id?: string;
  /** Operator hand-corrected this pulled line. Overwrite from Timesheets
   *  preserves flagged lines instead of rebuilding them (manual_override
   *  lines are always preserved regardless). Set automatically by the draft
   *  editor on any value edit to a pulled line; toggleable in the UI. */
  manuallyEdited?: boolean;
};

export type TimeEntry = {
  id: string;
  position: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  workDate?: string;           // YYYY-MM-DD — start date of pair 1 (defaults to job sheet date)
  endDate?: string;            // YYYY-MM-DD — end date of the last pair (>= workDate)
  timeIn1: string;
  timeOut1: string;
  timeIn2: string;
  timeOut2: string;
  lunchMinutes: number;        // LEGACY: kept for rollback safety. Not used in hours math.
  mealBreak1Minutes?: number;  // Pair 1 meal break (0/30/60). Seeded from lunchMinutes on migration.
  mealBreak2Minutes?: number;  // Pair 2 meal break (0/30/60).
  stdHours: number;
  otHours: number;
  dtHours: number;
  totalHours: number;
  // ─── Billing rates (NOT pay rates) ────────────────────────────────────
  // These are the rates AES bills the client. Same multiplier shape as the
  // rate card (OT = 1.5× std, DT = 2× std, per Connor) but admin-typed
  // per row today (no automatic source). billTotal = computed bill total
  // for this entry (hours × bill rates). Renamed from std_rate/ot_rate/
  // dt_rate/total_pay in migration 20260528b so the names no longer imply
  // pay-side. Pay rates live separately on payroll_run_entries — see
  // lib/store/payroll.ts.
  billStdRate: number;
  billOtRate: number;
  billDtRate: number;
  /** Hours after which OT bucket starts. Snapshotted from rate card at
   *  entry creation (migration 20260606a). NULL = no OT bucket — all
   *  hours stay in stdHours, no premium. Used by computeTimeEntry to
   *  split totalHours into the std/ot/dt buckets. */
  billOtAfter?: number | null;
  /** Hours after which DT bucket starts. Snapshotted from rate card at
   *  entry creation. NULL = no DT bucket. */
  billDtAfter?: number | null;
  billTotal: number;
  employeeKey?: string | null; // links to employees table
  userId?: string | null;      // set for staff-submitted entries
  status?: string | null;      // null=admin-created, submitted|approved|rejected for staff entries
  sortOrder?: number;
  createdAt?: string;
  // Phase 1 (2026-05-25): canonical link to the "Job" (job_requests row).
  // Populated for all new rows; backfilled on existing rows where a
  // confident match existed. NULL on legacy rows whose job_sheet has
  // no corresponding job_request (see migration 20260525c).
  jobId?: string | null;
  // Phase C invoice rewrite back-reference: set when the entry has been
  // pulled onto an invoice line. While non-NULL, the freeze trigger
  // (20260525d) super-locks the row — status changes are blocked until
  // the invoice line is unlinked via the invoice draft editor.
  invoiceLineId?: string | null;
  // Phase 2 (2026-05-26): canonical FK to job_request_shifts(id). Lets
  // timekeeping align with the same shift identity the plan and quote
  // already use. NULL means "any shift / unspecified" (legacy + jobs
  // with 0 or 1 shifts).
  shiftId?: string | null;
  // Phase 3 (2026-05-26): canonical position + specialty FKs. Backfilled
  // by name-match from the legacy `position` text on existing rows; new
  // rows write both columns. The text `position` field stays in place as
  // a historical snapshot and fallback display for legacy rows where the
  // name didn't resolve to a positions.id.
  positionId?: string | null;
  specialtyId?: string | null;
  // Phase 4 (2026-05-26): Pattern C holiday snapshot. Set true when the
  // entry's workDate falls on a day flagged is_holiday on the parent
  // job_request_days. Holiday rows compute pay as
  //   totalHours × stdRate × holidayMultiplier
  // (matching the quote/invoice rule — OT/DT premium does not stack).
  // holidayMultiplier is snapshot at row creation from the resolved rate
  // card; defaults to 2.0 in calc when null.
  isHoliday?: boolean;
  holidayMultiplier?: number | null;
  // Staff-app finalization signal (migration 20260614a). Set by the staff app when
  // a worker marks their actual time final; read-only in AOS (advisory — does not
  // gate approval). NULL/false on planned + admin-created rows.
  staffFinalized?: boolean;
  staffFinalizedAt?: string | null;
};

export type Timesheet = {
  id: string;
  // Legacy anchor — still populated for back-compat and for the 3 stragglers
  // whose job_id couldn't be resolved. Will be retired once those are cleaned.
  jobSheetId: string;
  // Phase 1: canonical FK to job_requests(id). Prefer this over jobSheetId
  // for any downstream linkage (invoice draft pulls, holiday math, etc.).
  jobId?: string | null;
  title: string;
  /** When true, the bill rate / total columns (STD BILL, OT BILL, DT BILL,
   *  TOTAL BILL) are hidden in the timekeeping editor. Originally named
   *  hide_pay_columns / hidePayColumns when those columns were misleadingly
   *  labeled "pay" — they were always bill data. Field renamed to
   *  hideBillColumns in the code; DB column stays hide_pay_columns for now
   *  to avoid an extra migration (mapper translates). */
  hideBillColumns: boolean;
  rows: TimeEntry[];
};

// Quote shape — covers both drafts (is_draft=true, status=null) and frozen rows
// (is_draft=false, status=issued|signed|superseded). See docs/quote-rewrite-plan.md.
//
// Existing legacy fields (client/eventName/venue/etc.) are populated by the
// issue_quote_draft RPC at issue time; on drafts they may be NULL while the UI
// reads live from the joined job_request.
export type QuoteDraft = {
  id: string;
  clientId?: string;
  client: string;
  eventName: string;
  venue: string;
  cityState: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  total: number;
  deposit: number;
  /** Deposit percentage of subtotal (0-100). Stored separately from `deposit`
   *  so user intent persists when subtotal changes — deposit $ is recomputed
   *  as needed. NULL is treated as 0. */
  depositPct?: number;
  /** issued | signed | superseded — NULL while is_draft=true */
  status: string | null;
  notes: string;
  lines: QuoteLine[];
  terms: string;
  /** Legacy text column — superseded by jobRequestId FK. Read-only after rewrite. */
  linkedJobRequestId?: string;
  /** Legacy — job_sheets being phased out. */
  linkedJobSheetId?: string;
  timesheetSummary?: Array<{ position: string; workers: number; stdHours: number; otHours: number; dtHours: number; totalHours: number; totalPay: number; }>;
  signatureName?: string;
  signedAt?: string;
  signedBy?: string;
  rateCardProfileId?: string;
  /** Holiday rate multiplier (e.g. 2.0, 2.5, 3.0). Snapshotted from the
   *  chosen rate card at draft creation; editable on the draft for one-off
   *  contract terms. Frozen on issue. Used by calc engine when a line's
   *  parent day is flagged is_holiday. */
  holidayMultiplier: number;
  /** Author info that prints on the quote PDF. Free-text. */
  preparedByName?: string;
  preparedByTitle?: string;
  // ─── New fields (quote rewrite Phase A) ────────────────────────────────────
  /** True while editable; false once issued. Frozen rows can't have content updated. */
  isDraft: boolean;
  /** FK to job_requests(id). Required for new drafts; legacy orphans may be NULL. */
  jobRequestId?: string;
  /** Set on revision drafts pointing at the parent frozen quote. */
  parentQuoteId?: string;
  /** AES_YYMMDDDD_CLI_EVENT_EST[_REVN] — populated at issue time, frozen forever. */
  quoteNo?: string;
  /** Original slug-style id preserved during V2 cutover backfill, for customer-reference lookups. */
  legacyQuoteNo?: string;
  revisionNo: number;
  issuedAt?: string;
  issuedBy?: string;
  supersededAt?: string;
  supersededBy?: string;
  // Audit columns
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

export type InvoiceDraft = {
  id: string;
  quoteId: string;
  invoiceNo: string;
  /** Original INV-YYYY-MMDD-NNN format preserved during V2 cutover backfill, for customer-reference lookups. */
  legacyInvoiceNo?: string;
  issueDate: string;
  dueDate: string;
  poNo: string;
  billTo: string;
  clientId?: string;
  client: string;
  eventName: string;
  venue: string;
  cityState: string;
  lines: QuoteLine[];
  subtotal: number;
  deposit: number;
  amountDue: number;
  terms: string;
  notes: string;
  /** issued | sent | paid | superseded | void — NULL while is_draft=true */
  status: string | null;
  paidAmount: number;
  rateCardProfileId?: string;
  /** Holiday rate multiplier (e.g. 2.0, 2.5, 3.0). Snapshotted from the
   *  source quote's holiday_multiplier at draft creation; editable on the
   *  draft. Frozen on issue. Used by calc engine on holiday-flagged days. */
  holidayMultiplier: number;
  linkedJobSheetId?: string;
  timesheetSummary?: Array<{ position: string; workers: number; stdHours: number; otHours: number; dtHours: number; totalHours: number; totalPay: number; }>;
  // ─── New fields (Phase C invoice rewrite) ────────────────────────────────
  /** True while editable; false once issued. Frozen rows can't have content updated. */
  isDraft: boolean;
  /** deposit | final */
  invoiceType?: "deposit" | "final";
  /** FK to job_requests(id). Required for new invoices; legacy orphans may be NULL. */
  jobRequestId?: string;
  /** FK to quotes(id). The new invoice is generated from this quote. */
  sourceQuoteId?: string;
  /** Snapshot of source quote's quote_no at issue. Frozen on the row. */
  sourceQuoteCode?: string;
  /** Set on revision drafts pointing at the parent frozen invoice. */
  parentInvoiceId?: string;
  /** Per-day finals: array of dates this invoice covers. NULL = whole job. */
  coveredDates?: string[];
  // invoiceNo already declared above (line ~155) — same field, holds the new
  // AES_..._INV / _DEP / _REV{N-1} format once issued.
  revisionNo: number;
  /** How much of the job's deposit credit is applied to this invoice. */
  depositApplied: number;
  /** SUM of customer_credit_ledger entries 'applied_to_invoice' for this invoice. Maintained by trigger. */
  creditsApplied: number;
  // Lifecycle audit
  issuedAt?: string;
  issuedBy?: string;
  sentAt?: string;
  sentBy?: string;
  paidAt?: string;
  paidBy?: string;
  supersededAt?: string;
  supersededBy?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  // Standard audit
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

// ─── Invoice payments + credits (Phase C invoice rewrite) ──────────────────
export type PaymentMethod = "check" | "ach" | "credit_card" | "cash" | "wire" | "zelle" | "venmo" | "money_order" | "other";

/** One payment received against one invoice. Replaces the prior
 *  customer_payments + payment_allocations two-table model
 *  (2026-05-27 redesign — single-invoice flow). */
export type InvoicePayment = {
  id: string;
  invoiceId: string;
  paymentDate: string;             // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  amount: number;
  /** Check #, CC transaction id, Venmo id, etc. — the rail's identifier. */
  referenceNumber?: string;
  /** What the customer wrote on the memo line. */
  memo?: string;
  /** Internal AES notes. */
  notes?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

export type CreditTransactionType = "overpayment" | "manual_credit" | "applied_to_invoice" | "refunded" | "written_off";

export type CustomerCreditLedgerEntry = {
  id: string;
  clientId: string;
  transactionDate: string;
  transactionType: CreditTransactionType;
  amount: number;                  // always positive; sign comes from type
  relatedInvoiceId?: string;
  refundReference?: string;
  refundMemo?: string;
  refundDate?: string;
  notes?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

// ─── Payroll (Phase 1) ─────────────────────────────────────────────────────
// A payroll_run is the "paydate header" — a group of approved timesheet
// entries snapshotted for payment on a given pay_date. payroll_run_entries
// carries the snapshot of hours/rates/pay so the run's totals stay correct
// even if a source timesheet entry is later (post-void) edited.
export type PayrollRunStatus = "draft" | "finalized" | "exported" | "voided";

export type PayrollRun = {
  id: string;
  payDate: string;             // YYYY-MM-DD
  periodStart?: string;
  periodEnd?: string;
  status: PayrollRunStatus;
  notes?: string;
  /** First day of the pay week — 'sun' (Connor's default) or 'mon'. */
  payWeekStart: "sun" | "mon";
  // Cached rollups maintained by trigger.
  entryCount: number;
  employeeCount: number;
  totalHours: number;
  totalPay: number;
  /** Stamped by finalizePayrollRun after weekly OT spill is applied. */
  otCalculatedAt?: string;
  otCalculatedBy?: string;
  // Lifecycle audit
  finalizedAt?: string;
  finalizedBy?: string;
  exportedAt?: string;
  exportedBy?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  // Standard audit
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

export type PayrollRunEntry = {
  id: string;
  payrollRunId: string;
  timesheetEntryId: string;
  // Snapshot fields — frozen at the moment the entry was added to the run.
  employeeKey?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  workDate?: string;
  position?: string;
  /** Specialty snapshot — denormalized name + FK. Lets the payroll grid
   *  display "Rigger / Climber" without joining, and survives later renames. */
  specialtyId?: string;
  specialty?: string;
  jobId?: string;
  /** BILLED hours — snapshot of timesheet std/ot/dt (what the client pays).
   *  Frozen at insert time; never recomputed. */
  stdHours: number;
  otHours: number;
  dtHours: number;
  totalHours: number;
  /** PAY hours — Connor's payroll rules applied (5hr min, round up, weekly
   *  40hr spill). totalPay is computed from these, not from std/ot/dt. */
  payStdHours: number;
  payOtHours: number;
  payDtHours: number;
  payTotalHours: number;
  /** Human-readable note about which rules adjusted the pay buckets,
   *  e.g. "5hr min applied; 6.5→7 rounded; +2hr weekly OT spill". */
  payAdjustmentReason?: string;
  stdRate: number;
  otRate: number;
  dtRate: number;
  isHoliday: boolean;
  holidayMultiplier?: number;
  totalPay: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

export type JobRequest = {
  id: string;
  clientId?: string;       // FK to clients table
  client: string;          // denormalized name; kept for downstream compat, drop later
  eventName: string;
  venue: string;
  venueAddress: string;
  venueAddress2?: string;
  venueZip?: string;
  city: string;
  state: string;
  cityState: string;
  receivedDate: string;   // date the inquiry came in; used for YTD stats
  requestDate: string;    // event start date
  endDate?: string;
  startTime: string;
  endTime: string;
  expectedHours?: number;
  addToCalendar?: boolean;
  status: string;
  notes: string;
  attachmentNames: string[];
  packetNotes: string;
  // linkedQuoteId removed 2026-05-05 — replaced by reverse FK lookup via
  // quotes.job_request_id (more reliable, no denormalization drift).
  // The user-facing identifier (display code). Auto-recomputed from
  // request_date/end_date/client.code/event_abbr while status='lead', then
  // stable. See project_todo.md ("Display-code naming convention").
  jobNo?: string;
  // The 8-char abbreviation that fills the EVENT slot of job_no.
  // Auto-derived from event_name on first save; user can override.
  eventAbbr?: string;
  // Override of which rate card the quote-create flow will use. NULL = auto
  // (effective-date-aware lookup keyed off client_id + request_date).
  rateCardProfileId?: string;
};

// Per-day breakdown of a multi-day job request. The legacy flat columns on
// job_requests (request_date, end_date, start_time, end_time, expected_hours)
// are kept in sync from these rows by a DB trigger during Phase 1 of the
// multi-day refactor.
export type JobRequestDay = {
  id: string;
  jobRequestId: string;
  eventDate: string;        // YYYY-MM-DD
  callTime?: string;
  startTime?: string;
  endTime?: string;
  expectedHours?: number;
  notes?: string;
  sortOrder: number;
  /** Operator-flagged holiday. Source of truth; snapshotted into quote_days
   *  and invoice_days on draft creation (Phase 2/3). 2.0× rate at calc time. */
  isHoliday: boolean;
};

export type JobRequestCrewNeed = {
  id: string;
  jobRequestDayId: string;
  positionId?: string;
  specialtyId?: string;
  /** Optional shift scope. NULL = "any shift / unspecified" (the default when
   *  a job has no defined shifts). Shift UI is hidden in single-shift jobs. */
  shiftId?: string;
  quantity: number;
  /** Hours for this position on this day. Defaults from the day's expected_hours
   *  on create, but can be overridden per row (e.g., 4 hr audio call vs 10 hr
   *  general crew on the same day). Used by the quote-create flow as line.hours. */
  hours?: number;
  notes?: string;
  sortOrder: number;
};

// One row per (day, employee) on a job. The actual person scheduled to
// work that day vs the crew_needs entries (which are unfilled targets).
// Replaces job_sheet_workers as the canonical assignment source once
// timekeeping is rewired to source crew from here.
export type JobRequestAssignment = {
  id: string;
  jobRequestDayId: string;
  employeeKey?: string;
  positionId?: string;
  specialtyId?: string;
  /** Optional shift scope. NULL = "any shift / unspecified". An employee can
   *  appear once per (day, shift) — DB unique index enforces. */
  shiftId?: string;
  confirmed: boolean;
  notes?: string;
  sortOrder: number;
};

export type JobSheetWorker = {
  employeeKey: string;
  fullName: string;
  firstName: string;
  lastName: string;
  stateCode: string;
  phone: string;
  email: string;
  role: string;
  confirmed: boolean;
};

export type JobSheet = {
  id: string;
  sourceEventId?: string;
  title: string;
  client: string;
  eventName: string;
  venue: string;
  venueAddress?: string;
  city?: string;
  state?: string;
  cityState: string;
  googleMapsLink?: string;
  date: string;
  callTime: string;
  notes: string;
  attachmentNames: string[];
  workers: JobSheetWorker[];
};

// Legacy type — kept exported so any straggler imports compile, but no longer
// part of EmployeeRecord. Documents now live in the employee_documents table;
// see lib/storage/employee-documents.ts for the canonical types.
export type EmployeeDocument = {
  id: string;
  name: string;
  dataUrl?: string;
};

export type EmployeeRecord = {
  employeeKey: string;
  employeeId?: string;
  fullName: string;
  firstName: string;
  lastName: string;
  payrollName?: string;
  preferredName?: string;
  status?: string;
  workerCategory?: string;
  positionStatus?: string;
  employmentType?: string;
  type: "staff" | "contractor";  // staff = internal employee; contractor = labor pool
  city?: string;
  state?: string;
  stateCode?: string;
  zip?: string;
  email?: string;
  phone?: string;
  address?: string;  // street address — matches Client.address. Old single-string addresses live in address_donotuse in DB (not mapped).
  notes?: string;
  profilePicture?: string;
  source?: string;
  // ─── Per-employee pay rate override (added 2026-05-28) ──────────────────
  // NULL on any column = "use rate card". Set value = override that wins
  // regardless of rate card. Used by the payroll module's resolvePayRateForEntry
  // helper when snapshotting a payroll run. NEVER rendered on client-facing
  // documents (quotes, invoices).
  /** Date the person was added to the roster. NULL on legacy rows
   *  pre-2026-05-28; the on-the-fly create flow from Timekeeping
   *  stamps this with today's date so HR can identify onboarding
   *  backlog without coordinator action. */
  hireDate?: string;
  payStdRate?: number | null;
  payOtRate?: number | null;
  payDtRate?: number | null;
  /** Rippling employee number — external payroll system identifier.
   *  Surfaced on the payroll-run CSV export so Rippling can match each
   *  row to its employee record. Most employees won't have one. */
  ripplingEmployeeId?: number | null;
};


export type Client = {
  id: string;
  name: string;
  code?: string;
  contactName?: string;
  billTo?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  isActive: boolean;
};

export type ClientContactType = "billing" | "quotes" | "job" | "other";

export type JobRequestAttachmentType =
  | "diagram"
  | "floor_plan"
  | "map"
  | "scope_packet"
  | "contract"
  | "photo"
  | "timesheet"
  | "other";

export type JobRequestAttachment = {
  id: string;
  jobRequestId: string;
  storagePath: string;
  url: string;
  fileName: string;
  description?: string;
  docType: JobRequestAttachmentType;
  mimeType?: string;
  fileSize?: number;
  uploadedAt: string;
  isActive: boolean;
};

export type ClientContact = {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  title?: string;
  phone?: string;
  email?: string;
  type: ClientContactType;
  isActive: boolean;
};

export type Position = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type Specialty = {
  id: string;
  positionId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

/** Job-scoped shift master. Each job_request defines its own list of shifts;
 *  lines reference shifts by FK. Replaced free-text shift_label in 20260512a. */
export type JobRequestShift = {
  id: string;
  jobRequestId: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

export type Profile = {
  id: string;          // matches auth.users.id (uuid)
  role: string;        // "admin" | "staff" | "crew_leader"
  employeeKey: string | null;
  fullName: string;
  email: string;
  // contact info (phone, address, city, state) lives on the employee record
};

export type UserWithProfile = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  profile: Profile | null;
};

export type JobCostingLine = {
  id: string;
  role: string;
  payRate: number;
  crewCount: number;
  stHours: number;
  otHours: number;
  dtHours: number;
  stRate: number;
  otRate: number;
  dtRate: number;
  quotedExpenses: number;
  actualPayRate: number;
  actualCrewCount: number;
  actualSTHours: number;
  actualOTHours: number;
  actualDTHours: number;
  actualExpenses: number;
  targetMargin: number;
  billMode?: "hourly" | "day";
  quotedBaseDay?: number;
  quotedOtTrigger?: number;
  manualRateOverride?: boolean;
  manualOtOverride?: boolean;
  manualDtOverride?: boolean;
};

// QuoteDraftWorkspace type retired 2026-05-05. Drafts now live directly on
// the quotes table (is_draft=true) — no separate JSONB workspace blob.

export type JobCostingDraft = {
  id: string;
  title: string;
  client: string;
  eventName: string;
  venue: string;
  cityState: string;
  linkedJobRequestId?: string;
  linkedQuoteId?: string;
  linkedJobSheetId?: string;
  linkedTimesheetId?: string;
  linkedRateCardProfileId?: string;
  payrollBurden: number;
  overheadPerHour: number;
  targetMargin: number;
  otPayMultiplier: number;
  dtPayMultiplier: number;
  otBillMultiplier: number;
  dtBillMultiplier: number;
  minimumHours: number;
  billedExpenses: number;
  rentals: number;
  passThroughMarkupRevenue: number;
  actualTravel: number;
  actualHotels: number;
  actualPerDiem: number;
  actualEquipment: number;
  actualOtherCosts: number;
  actualRevenueCollected: number;
  estimatedJobCost: number;
  lines: JobCostingLine[];
  createdAt: string;
  updatedAt: string;
};
