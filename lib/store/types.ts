
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
  qty: number;
  hours: number;
  holidayHours: number;
  travel: number;
  baseHourly: number;
  baseDay: number;
  otRate: number;
  dtRate: number;
  rule: string;
  total: number;
  // FK references to positions/specialties master tables
  positionId?: string;
  specialtyId?: string;
  // Discrete UI columns (populated from quote_lines / invoice_lines table)
  department?: string;
  specialty?: string;
  shiftLabel?: string;
  quoteDate?: string;
  endDate?: string;      // optional end date for shifts that span multiple days
  startTime?: string;
  endTime?: string;
  rateMode?: string;
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
  stdRate: number;
  otRate: number;
  dtRate: number;
  totalPay: number;
  employeeKey?: string | null; // links to employees table
  userId?: string | null;      // set for staff-submitted entries
  status?: string | null;      // null=admin-created, submitted|approved|rejected for staff entries
  sortOrder?: number;
  createdAt?: string;
};

export type Timesheet = {
  id: string;
  jobSheetId: string;
  title: string;
  hidePayColumns: boolean;
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
  expectedHoursPerDay?: number;
  total: number;
  deposit: number;
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
  // ─── New fields (quote rewrite Phase A) ────────────────────────────────────
  /** True while editable; false once issued. Frozen rows can't have content updated. */
  isDraft: boolean;
  /** FK to job_requests(id). Required for new drafts; legacy orphans may be NULL. */
  jobRequestId?: string;
  /** Set on revision drafts pointing at the parent frozen quote. */
  parentQuoteId?: string;
  /** AES_YYMMDDDD_CLI_EVENT_EST[_REVN] — populated at issue time, frozen forever. */
  quoteNo?: string;
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
  status: string;
  paidAmount: number;
  rateCardProfileId?: string;
  linkedJobSheetId?: string;
  timesheetSummary?: Array<{ position: string; workers: number; stdHours: number; otHours: number; dtHours: number; totalHours: number; totalPay: number; }>;
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
  linkedQuoteId?: string;  // set when a quote is built from this request
  // The user-facing identifier (display code). Auto-recomputed from
  // request_date/end_date/client.code/event_abbr while status='lead', then
  // stable. See project_todo.md ("Display-code naming convention").
  jobNo?: string;
  // The 8-char abbreviation that fills the EVENT slot of job_no.
  // Auto-derived from event_name on first save; user can override.
  eventAbbr?: string;
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
};

export type JobRequestCrewNeed = {
  id: string;
  jobRequestDayId: string;
  positionId?: string;
  specialtyId?: string;
  quantity: number;
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

export type QuoteDraftWorkspace = {
  id: string;
  clientId?: string;
  name: string;
  updatedAt: string;
  data: any;
};

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
