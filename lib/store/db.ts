/**
 * lib/store/db.ts
 *
 * In-memory cache synchronized with Supabase.
 *
 * Design:
 *  - Reads are synchronous (from cache) — existing components need no changes.
 *  - Writes update the cache immediately, then fire-and-forget to Supabase.
 *  - Call initStore() once on app startup (see components/layout/store-provider.tsx).
 */

import { supabase } from "../supabase/client";
import { computeTimeEntry } from "./timekeeping";
import type {
  CalendarEvent,
  QuoteDraft,
  QuoteDraftWorkspace,
  InvoiceDraft,
  JobRequest,
  JobSheet,
  Timesheet,
  EmployeeRecord,
  JobCostingDraft,
  Position,
} from "./types";
import { DEFAULT_RATE_ROWS, DEFAULT_TERMS, type RateCardProfile, type RateRow } from "../rates/defaults";

// ─── Cache ────────────────────────────────────────────────────────────────────

interface Cache {
  initialized: boolean;
  manualEvents: CalendarEvent[];
  deletedEventIds: string[];
  eventProfiles: Record<string, { notes: string; attachmentNames: string[] }>;
  quotes: QuoteDraft[];
  quoteDraftWorkspaces: QuoteDraftWorkspace[];
  invoiceDrafts: InvoiceDraft[];
  jobRequests: JobRequest[];
  jobSheets: JobSheet[];
  timesheets: Timesheet[];
  employees: EmployeeRecord[];
  deletedEmployeeKeys: string[];
  jobCostingDrafts: JobCostingDraft[];
  rateRows: RateRow[];
  terms: string;
  clientName: string;
  rateCardProfiles: RateCardProfile[];
  positions: Position[];
}

const _cache: Cache = {
  initialized: false,
  manualEvents: [],
  deletedEventIds: [],
  eventProfiles: {},
  quotes: [],
  quoteDraftWorkspaces: [],
  invoiceDrafts: [],
  jobRequests: [],
  jobSheets: [],
  timesheets: [],
  employees: [],
  deletedEmployeeKeys: [],
  jobCostingDrafts: [],
  rateRows: DEFAULT_RATE_ROWS,
  terms: DEFAULT_TERMS,
  clientName: "",
  rateCardProfiles: [],
  positions: [],
};

export function isInitialized(): boolean {
  return _cache.initialized;
}

// ─── Initialization ───────────────────────────────────────────────────────────

let _initPromise: Promise<void> | null = null;

export function initStore(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = _loadAll().catch((err) => {
    console.error("[db] initStore failed:", err);
    // Still mark initialized so the app doesn't hang; data will be empty.
    _cache.initialized = true;
  });
  return _initPromise;
}

// Supabase caps queries at 1000 rows by default — page through all employees.
async function fetchAllEmployees(): Promise<{ data: any[] | null; error: any }> {
  const PAGE = 1000;
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    all = all.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return { data: all, error: null };
}

async function _loadAll() {
  const { data: { user } } = await supabase.auth.getUser();
  console.log("[db] loading as user:", user?.email ?? "NULL (unauthenticated)");
  if (!user) {
    console.warn("[db] No authenticated user — all queries will return empty due to RLS.");
    _cache.initialized = true;
    return;
  }
  const [
    eventsRes,
    quotesRes,
    workspacesRes,
    invoicesRes,
    jobRequestsRes,
    jobSheetsRes,
    jobSheetWorkersRes,
    timesheetsRes,
    entriesRes,
    employeesRes,
    jobCostingRes,
    rateProfilesRes,
    rateStateRes,
    positionsRes,
  ] = await Promise.all([
    supabase.from("calendar_events").select("*"),
    supabase.from("quotes").select("*"),
    supabase.from("quote_draft_workspaces").select("*"),
    supabase.from("invoices").select("*"),
    supabase.from("job_requests").select("*"),
    supabase.from("job_sheets").select("*"),
    supabase.from("job_sheet_workers").select("*").order("sort_order"),
    supabase.from("timesheets").select("id, job_sheet_id, title, hide_pay_columns"),
    supabase.from("timesheet_entries").select("*").not("timesheet_id", "is", null),
    fetchAllEmployees(),
    supabase.from("job_costing_drafts").select("*"),
    supabase.from("rate_card_profiles").select("*"),
    supabase.from("app_rate_state").select("*"),
    supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
  ]);

  const events = eventsRes.data ?? [];
  _cache.manualEvents = events.filter((r: any) => !r.is_deleted).map(rowToCalendarEvent);
  _cache.deletedEventIds = events.filter((r: any) => r.is_deleted).map((r: any) => r.id);
  _cache.eventProfiles = {};
  for (const r of events) {
    if (r.profile_notes || (r.profile_attachment_names?.length ?? 0) > 0) {
      _cache.eventProfiles[r.id] = {
        notes: r.profile_notes ?? "",
        attachmentNames: r.profile_attachment_names ?? [],
      };
    }
  }

  _cache.quotes = (quotesRes.data ?? []).map(rowToQuote);
  _cache.quoteDraftWorkspaces = (workspacesRes.data ?? []).map(rowToWorkspace);
  _cache.invoiceDrafts = (invoicesRes.data ?? []).map(rowToInvoice);
  _cache.jobRequests = (jobRequestsRes.data ?? []).map(rowToJobRequest);
  // Group workers by job_sheet_id and attach
  const workersByJobSheetId = new Map<string, any[]>();
  for (const w of (jobSheetWorkersRes.data ?? [])) {
    const jsid = w.job_sheet_id;
    if (!workersByJobSheetId.has(jsid)) workersByJobSheetId.set(jsid, []);
    workersByJobSheetId.get(jsid)!.push(w);
  }
  _cache.jobSheets = (jobSheetsRes.data ?? []).map((r: any) => rowToJobSheet(r, workersByJobSheetId.get(r.id) ?? []));
  // Group entries by timesheet_id and attach as rows
  const entriesByTimesheetId = new Map<string, any[]>();
  for (const e of (entriesRes.data ?? [])) {
    const tid = e.timesheet_id;
    if (!entriesByTimesheetId.has(tid)) entriesByTimesheetId.set(tid, []);
    entriesByTimesheetId.get(tid)!.push(e);
  }
  _cache.timesheets = (timesheetsRes.data ?? []).map((r: any) => rowToTimesheet(r, entriesByTimesheetId.get(r.id) ?? []));

  const emps = employeesRes.data ?? [];
  _cache.employees = emps.filter((r: any) => !r.is_deleted).map(rowToEmployee);
  _cache.deletedEmployeeKeys = emps.filter((r: any) => r.is_deleted).map((r: any) => r.employee_key);

  _cache.jobCostingDrafts = (jobCostingRes.data ?? []).map(rowToJobCosting);
  _cache.rateCardProfiles = (rateProfilesRes.data ?? []).map(rowToRateCardProfile);

  const rateStateMap: Record<string, any> = {};
  for (const r of rateStateRes.data ?? []) rateStateMap[r.key] = r.value;
  if (rateStateMap["rate_rows"]) _cache.rateRows = rateStateMap["rate_rows"];
  if (rateStateMap["terms"]) _cache.terms = rateStateMap["terms"];
  if (rateStateMap["client_name"]) _cache.clientName = rateStateMap["client_name"];

  _cache.positions = (positionsRes.data ?? []).map(rowToPosition);

  _cache.initialized = true;
}

// ─── Sync helpers ─────────────────────────────────────────────────────────────

function sync(table: string, row: object) {
  supabase
    .from(table)
    .upsert(row)
    .then(({ error }) => {
      if (error) console.error(`[db] sync error on ${table}:`, error);
    });
}

function syncRateState(key: string, value: unknown) {
  supabase
    .from("app_rate_state")
    .upsert({ key, value })
    .then(({ error }) => {
      if (error) console.error("[db] rate state sync error:", error);
    });
}

// ─── Calendar Events ──────────────────────────────────────────────────────────

export function getManualEvents() { return _cache.manualEvents; }
export function getDeletedEventIds() { return _cache.deletedEventIds; }
export function getEventProfiles() { return _cache.eventProfiles; }

export function setManualEvents(rows: CalendarEvent[]) {
  _cache.manualEvents = rows;
  for (const r of rows) sync("calendar_events", calendarEventToRow(r, false));
}

export function upsertManualEvent(row: CalendarEvent) {
  _cache.manualEvents = [..._cache.manualEvents.filter((r) => r.id !== row.id), row];
  sync("calendar_events", calendarEventToRow(row, false));
}

export function deleteEventById(id: string) {
  if (!_cache.deletedEventIds.includes(id)) _cache.deletedEventIds.push(id);
  _cache.manualEvents = _cache.manualEvents.filter((e) => e.id !== id);
  supabase
    .from("calendar_events")
    .update({ is_deleted: true })
    .eq("id", id)
    .then(({ error }) => { if (error) console.error("[db] deleteEvent error:", error); });
}

export function undeleteAllEvents() {
  _cache.deletedEventIds = [];
  supabase
    .from("calendar_events")
    .update({ is_deleted: false })
    .then(({ error }) => { if (error) console.error("[db] undeleteEvents error:", error); });
}

export function saveEventProfile(eventId: string, data: { notes: string; attachmentNames: string[] }) {
  _cache.eventProfiles[eventId] = data;
  supabase
    .from("calendar_events")
    .update({ profile_notes: data.notes, profile_attachment_names: data.attachmentNames })
    .eq("id", eventId)
    .then(({ error }) => { if (error) console.error("[db] saveEventProfile error:", error); });
}

// ─── Quotes ───────────────────────────────────────────────────────────────────

export function getQuotes() { return _cache.quotes; }

export function setQuotes(rows: QuoteDraft[]) {
  _cache.quotes = rows;
  for (const r of rows) sync("quotes", quoteToRow(r));
}

export function upsertQuote(row: QuoteDraft) {
  _cache.quotes = [..._cache.quotes.filter((r) => r.id !== row.id), row];
  sync("quotes", quoteToRow(row));
}

// ─── Quote Draft Workspaces ───────────────────────────────────────────────────

export function getQuoteDraftWorkspaces() { return _cache.quoteDraftWorkspaces; }

export function setQuoteDraftWorkspaces(rows: QuoteDraftWorkspace[]) {
  _cache.quoteDraftWorkspaces = rows;
  for (const r of rows) sync("quote_draft_workspaces", workspaceToRow(r));
}

export function upsertQuoteDraftWorkspace(row: QuoteDraftWorkspace) {
  const next = [row, ..._cache.quoteDraftWorkspaces.filter((r) => r.id !== row.id)].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt)
  );
  _cache.quoteDraftWorkspaces = next;
  sync("quote_draft_workspaces", workspaceToRow(row));
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export function getInvoiceDrafts() { return _cache.invoiceDrafts; }

export function setInvoiceDrafts(rows: InvoiceDraft[]) {
  _cache.invoiceDrafts = rows;
  for (const r of rows) sync("invoices", invoiceToRow(r));
}

export function upsertInvoiceDraft(row: InvoiceDraft) {
  _cache.invoiceDrafts = [..._cache.invoiceDrafts.filter((r) => r.id !== row.id), row];
  sync("invoices", invoiceToRow(row));
}

// ─── Job Requests ─────────────────────────────────────────────────────────────

export function getJobRequests() { return _cache.jobRequests; }

export function setJobRequests(rows: JobRequest[]) {
  _cache.jobRequests = rows;
  for (const r of rows) sync("job_requests", jobRequestToRow(r));
}

export function upsertJobRequest(row: JobRequest) {
  _cache.jobRequests = [..._cache.jobRequests.filter((r) => r.id !== row.id), row];
  sync("job_requests", jobRequestToRow(row));
}

// ─── Job Sheets ───────────────────────────────────────────────────────────────

export function getJobSheets() { return _cache.jobSheets; }

export function setJobSheets(rows: JobSheet[]) {
  _cache.jobSheets = rows;
  for (const r of rows) syncJobSheet(r);
}

export function upsertJobSheet(row: JobSheet) {
  _cache.jobSheets = [..._cache.jobSheets.filter((r) => r.id !== row.id), row];
  syncJobSheet(row);
}

function syncJobSheet(j: JobSheet) {
  // Upsert the header row (no workers column)
  supabase
    .from("job_sheets")
    .upsert(jobSheetToRow(j))
    .then(({ error }) => { if (error) console.error("[db] syncJobSheet header error:", error); });
  // Replace all workers for this job sheet
  supabase
    .from("job_sheet_workers")
    .delete()
    .eq("job_sheet_id", j.id)
    .then(({ error }) => {
      if (error) { console.error("[db] syncJobSheet delete workers error:", error); return; }
      if (j.workers.length === 0) return;
      const workerRows = j.workers.map((w, idx) => jobSheetWorkerToRow(w, j.id, idx));
      supabase
        .from("job_sheet_workers")
        .insert(workerRows)
        .then(({ error: insertError }) => { if (insertError) console.error("[db] syncJobSheet insert workers error:", insertError); });
    });
}

// ─── Timesheets ───────────────────────────────────────────────────────────────

export function getTimesheets() { return _cache.timesheets; }

export function setTimesheets(rows: Timesheet[]) {
  _cache.timesheets = rows;
  for (const r of rows) syncTimesheet(r);
}

export function upsertTimesheet(row: Timesheet) {
  _cache.timesheets = [..._cache.timesheets.filter((r) => r.id !== row.id), row];
  syncTimesheet(row);
}

// ─── Staff timesheet submission review ────────────────────────────────────────

export async function getPendingStaffEntries(jobSheetId: string): Promise<import("./types").TimeEntry[]> {
  const { data, error } = await supabase
    .from("timesheet_entries")
    .select("*")
    .eq("job_sheet_id", jobSheetId)
    .is("timesheet_id", null)
    .eq("status", "submitted")
    .order("updated_at");
  if (error) { console.error("[db] getPendingStaffEntries:", error); return []; }
  return (data ?? []).map((r) => computeTimeEntry(rowToTimeEntry(r)));
}

export async function approveStaffEntry(entryId: string, timesheetId: string): Promise<void> {
  const { error } = await supabase
    .from("timesheet_entries")
    .update({ timesheet_id: timesheetId, status: "approved", updated_at: new Date().toISOString() })
    .eq("id", entryId);
  if (error) console.error("[db] approveStaffEntry:", error);
}

export async function rejectStaffEntry(entryId: string): Promise<void> {
  const { error } = await supabase
    .from("timesheet_entries")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", entryId);
  if (error) console.error("[db] rejectStaffEntry:", error);
}

export async function setEntryApproved(entryId: string): Promise<void> {
  const { error } = await supabase
    .from("timesheet_entries")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", entryId);
  if (error) console.error("[db] setEntryApproved:", error);
}

function syncTimesheet(t: Timesheet) {
  // Upsert header (no rows column)
  supabase
    .from("timesheets")
    .upsert({ id: t.id, job_sheet_id: t.jobSheetId, title: t.title, hide_pay_columns: t.hidePayColumns })
    .then(({ error }) => { if (error) console.error("[db] syncTimesheet header error:", error); });
  // Replace only AOS-managed entries (user_id IS NULL).
  // Staff-submitted entries (user_id set) are managed by their own approval flow
  // and must not be overwritten by admin syncs.
  supabase
    .from("timesheet_entries")
    .delete()
    .eq("timesheet_id", t.id)
    .is("user_id", null)
    .then(({ error }) => {
      if (error) { console.error("[db] syncTimesheet delete entries error:", error); return; }
      const aosManagedRows = t.rows.filter((r) => !r.userId);
      if (aosManagedRows.length === 0) return;
      const entryRows = aosManagedRows.map((r, idx) => timesheetEntryToRow(r, t.id, t.jobSheetId, idx));
      supabase
        .from("timesheet_entries")
        .insert(entryRows)
        .then(({ error: insertError }) => { if (insertError) console.error("[db] syncTimesheet insert entries error:", insertError); });
    });
}

// ─── Employees ────────────────────────────────────────────────────────────────

export function getEmployees() { return _cache.employees; }
export function getDeletedEmployeeKeys() { return _cache.deletedEmployeeKeys; }

export function setEmployees(rows: EmployeeRecord[]) {
  _cache.employees = rows;
  for (const r of rows) sync("employees", employeeToRow(r, false));
}

export function upsertEmployee(row: EmployeeRecord) {
  _cache.employees = [..._cache.employees.filter((r) => r.employeeKey !== row.employeeKey), row];
  sync("employees", employeeToRow(row, false));
}

export function markEmployeeDeleted(employeeKey: string) {
  if (!_cache.deletedEmployeeKeys.includes(employeeKey)) _cache.deletedEmployeeKeys.push(employeeKey);
  _cache.employees = _cache.employees.filter((e) => e.employeeKey !== employeeKey);
  supabase
    .from("employees")
    .update({ is_deleted: true })
    .eq("employee_key", employeeKey)
    .then(({ error }) => { if (error) console.error("[db] markEmployeeDeleted error:", error); });
}

export async function bulkUpsertEmployees(rows: EmployeeRecord[]): Promise<{ inserted: number; errors: number }> {
  const BATCH = 100;
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => employeeToRow(r, false));
    const { error, data } = await supabase.from("employees").upsert(batch, { onConflict: "employee_key" }).select("employee_key");
    if (error) {
      console.error("[db] bulkUpsertEmployees batch error:", error);
      errors += batch.length;
    } else {
      inserted += data?.length ?? batch.length;
    }
  }
  // Reload cache from Supabase so the UI reflects the full set
  const { data } = await fetchAllEmployees();
  if (data) {
    _cache.employees = data.filter((r: any) => !r.is_deleted).map(rowToEmployee);
    _cache.deletedEmployeeKeys = data.filter((r: any) => r.is_deleted).map((r: any) => r.employee_key);
  }
  return { inserted, errors };
}

// ─── Job Costing ──────────────────────────────────────────────────────────────

export function getJobCostingDrafts() { return _cache.jobCostingDrafts; }

export function setJobCostingDrafts(rows: JobCostingDraft[]) {
  _cache.jobCostingDrafts = rows;
  for (const r of rows) sync("job_costing_drafts", jobCostingToRow(r));
}

export function upsertJobCostingDraft(row: JobCostingDraft) {
  _cache.jobCostingDrafts = [..._cache.jobCostingDrafts.filter((r) => r.id !== row.id), row];
  sync("job_costing_drafts", jobCostingToRow(row));
}

// ─── Rate Card ────────────────────────────────────────────────────────────────

export function getRateRows() { return _cache.rateRows; }
export function getTerms() { return _cache.terms; }
export function getClientName() { return _cache.clientName; }
export function getRateCardProfiles() { return _cache.rateCardProfiles; }

export function setRateRows(rows: RateRow[]) {
  _cache.rateRows = rows;
  syncRateState("rate_rows", rows);
}

export function setTerms(value: string) {
  _cache.terms = value;
  syncRateState("terms", value);
}

export function setClientName(value: string) {
  _cache.clientName = value;
  syncRateState("client_name", value);
}

export function upsertRateCardProfile(profile: RateCardProfile) {
  const next = [..._cache.rateCardProfiles.filter((r) => r.id !== profile.id), profile].sort(
    (a, b) => a.clientName.localeCompare(b.clientName)
  );
  _cache.rateCardProfiles = next;
  sync("rate_card_profiles", rateCardProfileToRow(profile));
}

// ─── Row → Type mappers ───────────────────────────────────────────────────────

function rowToCalendarEvent(r: any): CalendarEvent {
  return {
    id: r.id,
    source: r.source ?? "",
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    venueAddress: r.venue_address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    cityState: r.city_state ?? "",
    googleMapsLink: r.google_maps_link ?? undefined,
    startDate: r.start_date ?? "",
    endDate: r.end_date ?? "",
    startTime: r.start_time ?? "",
    endTime: r.end_time ?? "",
    notes: r.notes ?? "",
    status: r.status ?? "",
    lead: r.lead ?? undefined,
    hands: r.hands ?? undefined,
  };
}

function rowToQuote(r: any): QuoteDraft {
  return {
    id: r.id,
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
    status: r.status ?? "draft",
    notes: r.notes ?? "",
    lines: r.lines ?? [],
    terms: r.terms ?? "",
    linkedJobRequestId: r.linked_job_request_id ?? undefined,
    linkedJobSheetId: r.linked_job_sheet_id ?? undefined,
    timesheetSummary: r.timesheet_summary ?? undefined,
    signatureName: r.signature_name ?? undefined,
    signedAt: r.signed_at ?? undefined,
    rateCardProfileId: r.rate_card_profile_id ?? undefined,
  };
}

function rowToWorkspace(r: any): QuoteDraftWorkspace {
  return {
    id: r.id,
    name: r.name ?? "",
    updatedAt: r.updated_at ?? "",
    data: r.data ?? {},
  };
}

function rowToInvoice(r: any): InvoiceDraft {
  return {
    id: r.id,
    quoteId: r.quote_id ?? "",
    invoiceNo: r.invoice_no ?? "",
    issueDate: r.issue_date ?? "",
    dueDate: r.due_date ?? "",
    poNo: r.po_no ?? "",
    billTo: r.bill_to ?? "",
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    cityState: r.city_state ?? "",
    lines: r.lines ?? [],
    subtotal: r.subtotal ?? 0,
    deposit: r.deposit ?? 0,
    amountDue: r.amount_due ?? 0,
    terms: r.terms ?? "",
    notes: r.notes ?? "",
    status: r.status ?? "",
    paidAmount: r.paid_amount ?? 0,
    rateCardProfileId: r.rate_card_profile_id ?? undefined,
    linkedJobSheetId: r.linked_job_sheet_id ?? undefined,
    timesheetSummary: r.timesheet_summary ?? undefined,
  };
}

function rowToJobRequest(r: any): JobRequest {
  return {
    id: r.id,
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    venueAddress: r.venue_address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    cityState: r.city_state ?? "",
    googleMapsLink: r.google_maps_link ?? "",
    requestDate: r.request_date ?? "",
    endDate: r.end_date ?? undefined,
    startTime: r.start_time ?? "",
    endTime: r.end_time ?? "",
    expectedHours: r.expected_hours ?? undefined,
    addToCalendar: r.add_to_calendar ?? undefined,
    status: r.status ?? "",
    notes: r.notes ?? "",
    attachmentNames: r.attachment_names ?? [],
    packetNotes: r.packet_notes ?? "",
  };
}

function rowToJobSheet(r: any, workerRows: any[] = []): JobSheet {
  return {
    id: r.id,
    sourceEventId: r.source_event_id ?? undefined,
    title: r.title ?? "",
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    venueAddress: r.venue_address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    cityState: r.city_state ?? "",
    googleMapsLink: r.google_maps_link ?? undefined,
    date: r.date ?? "",
    callTime: r.call_time ?? "",
    notes: r.notes ?? "",
    attachmentNames: r.attachment_names ?? [],
    workers: workerRows.map(rowToJobSheetWorker),
  };
}

function rowToJobSheetWorker(r: any): import("./types").JobSheetWorker {
  return {
    employeeKey: r.employee_key ?? "",
    fullName: r.full_name ?? "",
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    stateCode: r.state_code ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    role: r.role ?? "",
    confirmed: r.confirmed ?? false,
  };
}

function jobSheetWorkerToRow(w: import("./types").JobSheetWorker, jobSheetId: string, sortOrder: number) {
  return {
    job_sheet_id: jobSheetId,
    employee_key: w.employeeKey,
    full_name: w.fullName,
    first_name: w.firstName,
    last_name: w.lastName,
    state_code: w.stateCode,
    phone: w.phone,
    email: w.email,
    role: w.role,
    confirmed: w.confirmed,
    sort_order: sortOrder,
  };
}

function rowToTimesheet(r: any, entries: any[]): Timesheet {
  return {
    id: r.id,
    jobSheetId: r.job_sheet_id ?? "",
    title: r.title ?? "",
    hidePayColumns: r.hide_pay_columns ?? false,
    rows: entries
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((e) => computeTimeEntry(rowToTimeEntry(e))),
  };
}

function rowToTimeEntry(r: any): import("./types").TimeEntry {
  return {
    id: r.id,
    position: r.position ?? "",
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    timeIn1: r.time_in1 ?? "",
    timeOut1: r.time_out1 ?? "",
    lunchMinutes: r.lunch_minutes ?? 30,
    timeIn2: r.time_in2 ?? "",
    timeOut2: r.time_out2 ?? "",
    stdHours: r.std_hours ?? 0,
    otHours: r.ot_hours ?? 0,
    dtHours: r.dt_hours ?? 0,
    totalHours: r.total_hours ?? 0,
    stdRate: r.std_rate ?? 35,
    otRate: r.ot_rate ?? 52,
    dtRate: r.dt_rate ?? 70,
    totalPay: r.total_pay ?? 0,
    employeeKey: r.employee_key ?? null,
    userId: r.user_id ?? null,
    status: r.status ?? null,
    sortOrder: r.sort_order ?? 0,
  };
}

function timesheetEntryToRow(e: import("./types").TimeEntry, timesheetId: string, jobSheetId: string, sortOrder: number) {
  return {
    id: e.id,
    timesheet_id: timesheetId,
    job_sheet_id: jobSheetId,
    employee_key: e.employeeKey ?? null,
    user_id: e.userId ?? null,
    position: e.position,
    first_name: e.firstName,
    last_name: e.lastName,
    phone: e.phone,
    email: e.email,
    time_in1: e.timeIn1,
    time_out1: e.timeOut1,
    lunch_minutes: e.lunchMinutes,
    time_in2: e.timeIn2,
    time_out2: e.timeOut2,
    std_hours: e.stdHours,
    ot_hours: e.otHours,
    dt_hours: e.dtHours,
    total_hours: e.totalHours,
    std_rate: e.stdRate,
    ot_rate: e.otRate,
    dt_rate: e.dtRate,
    total_pay: e.totalPay,
    sort_order: sortOrder,
    status: e.status ?? null,
    updated_at: new Date().toISOString(),
  };
}

function rowToEmployee(r: any): EmployeeRecord {
  return {
    employeeKey: r.employee_key,
    employeeId: r.employee_id ?? undefined,
    fullName: r.full_name ?? "",
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    payrollName: r.payroll_name ?? undefined,
    preferredName: r.preferred_name ?? undefined,
    status: r.status ?? undefined,
    workerCategory: r.worker_category ?? undefined,
    positionStatus: r.position_status ?? undefined,
    employmentType: r.employment_type ?? undefined,
    type: r.employment_type === "Employee" ? "staff" : "contractor",
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    stateCode: r.state_code ?? undefined,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    notes: r.notes ?? undefined,
    profilePicture: r.profile_picture ?? undefined,
    documents: r.documents ?? undefined,
    source: r.source ?? undefined,
  };
}

function rowToJobCosting(r: any): JobCostingDraft {
  return {
    id: r.id,
    title: r.title ?? "",
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    cityState: r.city_state ?? "",
    linkedJobRequestId: r.linked_job_request_id ?? undefined,
    linkedQuoteId: r.linked_quote_id ?? undefined,
    linkedJobSheetId: r.linked_job_sheet_id ?? undefined,
    linkedTimesheetId: r.linked_timesheet_id ?? undefined,
    linkedRateCardProfileId: r.linked_rate_card_profile_id ?? undefined,
    payrollBurden: r.payroll_burden ?? 0.15,
    overheadPerHour: r.overhead_per_hour ?? 3,
    targetMargin: r.target_margin ?? 0.25,
    otPayMultiplier: r.ot_pay_multiplier ?? 1.5,
    dtPayMultiplier: r.dt_pay_multiplier ?? 2.0,
    otBillMultiplier: r.ot_bill_multiplier ?? 1.5,
    dtBillMultiplier: r.dt_bill_multiplier ?? 2.0,
    minimumHours: r.minimum_hours ?? 5,
    billedExpenses: r.billed_expenses ?? 0,
    rentals: r.rentals ?? 0,
    passThroughMarkupRevenue: r.pass_through_markup_revenue ?? 0,
    actualTravel: r.actual_travel ?? 0,
    actualHotels: r.actual_hotels ?? 0,
    actualPerDiem: r.actual_per_diem ?? 0,
    actualEquipment: r.actual_equipment ?? 0,
    actualOtherCosts: r.actual_other_costs ?? 0,
    actualRevenueCollected: r.actual_revenue_collected ?? 0,
    estimatedJobCost: r.estimated_job_cost ?? 0,
    lines: r.lines ?? [],
    createdAt: r.created_at ?? new Date().toISOString(),
    updatedAt: r.updated_at ?? new Date().toISOString(),
  };
}

function rowToRateCardProfile(r: any): RateCardProfile {
  return {
    id: r.id,
    clientName: r.client_name ?? "",
    rows: r.rows ?? [],
    terms: r.terms ?? "",
    createdAt: r.created_at ?? new Date().toISOString(),
    updatedAt: r.updated_at ?? new Date().toISOString(),
  };
}

// ─── Type → Row mappers ───────────────────────────────────────────────────────

function calendarEventToRow(e: CalendarEvent, isDeleted: boolean) {
  const profile = _cache.eventProfiles[e.id];
  return {
    id: e.id,
    source: e.source,
    client: e.client,
    event_name: e.eventName,
    venue: e.venue,
    venue_address: e.venueAddress ?? null,
    city: e.city ?? null,
    state: e.state ?? null,
    city_state: e.cityState,
    google_maps_link: e.googleMapsLink ?? null,
    start_date: e.startDate,
    end_date: e.endDate,
    start_time: e.startTime,
    end_time: e.endTime,
    notes: e.notes,
    status: e.status,
    lead: e.lead ?? null,
    hands: e.hands ?? null,
    is_deleted: isDeleted,
    profile_notes: profile?.notes ?? null,
    profile_attachment_names: profile?.attachmentNames ?? [],
  };
}

function quoteToRow(q: QuoteDraft) {
  return {
    id: q.id,
    client: q.client,
    event_name: q.eventName,
    venue: q.venue,
    city_state: q.cityState,
    start_date: q.startDate,
    end_date: q.endDate,
    start_time: q.startTime,
    end_time: q.endTime,
    expected_hours_per_day: q.expectedHoursPerDay ?? null,
    total: q.total,
    deposit: q.deposit,
    status: q.status,
    notes: q.notes,
    lines: q.lines,
    terms: q.terms,
    linked_job_request_id: q.linkedJobRequestId ?? null,
    linked_job_sheet_id: q.linkedJobSheetId ?? null,
    timesheet_summary: q.timesheetSummary ?? null,
    signature_name: q.signatureName ?? null,
    signed_at: q.signedAt ?? null,
    rate_card_profile_id: q.rateCardProfileId ?? null,
  };
}

function workspaceToRow(w: QuoteDraftWorkspace) {
  return {
    id: w.id,
    name: w.name,
    updated_at: w.updatedAt,
    data: w.data,
  };
}

function invoiceToRow(inv: InvoiceDraft) {
  return {
    id: inv.id,
    quote_id: inv.quoteId,
    invoice_no: inv.invoiceNo,
    issue_date: inv.issueDate,
    due_date: inv.dueDate,
    po_no: inv.poNo,
    bill_to: inv.billTo,
    client: inv.client,
    event_name: inv.eventName,
    venue: inv.venue,
    city_state: inv.cityState,
    lines: inv.lines,
    subtotal: inv.subtotal,
    deposit: inv.deposit,
    amount_due: inv.amountDue,
    terms: inv.terms,
    notes: inv.notes,
    status: inv.status,
    paid_amount: inv.paidAmount,
    rate_card_profile_id: inv.rateCardProfileId ?? null,
    linked_job_sheet_id: inv.linkedJobSheetId ?? null,
    timesheet_summary: inv.timesheetSummary ?? null,
  };
}

function jobRequestToRow(j: JobRequest) {
  return {
    id: j.id,
    client: j.client,
    event_name: j.eventName,
    venue: j.venue,
    venue_address: j.venueAddress,
    city: j.city,
    state: j.state,
    city_state: j.cityState,
    google_maps_link: j.googleMapsLink,
    request_date: j.requestDate,
    end_date: j.endDate ?? null,
    start_time: j.startTime,
    end_time: j.endTime,
    expected_hours: j.expectedHours ?? null,
    add_to_calendar: j.addToCalendar ?? null,
    status: j.status,
    notes: j.notes,
    attachment_names: j.attachmentNames,
    packet_notes: j.packetNotes,
  };
}

function jobSheetToRow(j: JobSheet) {
  return {
    id: j.id,
    source_event_id: j.sourceEventId ?? null,
    title: j.title,
    client: j.client,
    event_name: j.eventName,
    venue: j.venue,
    venue_address: j.venueAddress ?? null,
    city: j.city ?? null,
    state: j.state ?? null,
    city_state: j.cityState,
    google_maps_link: j.googleMapsLink ?? null,
    date: j.date,
    call_time: j.callTime,
    notes: j.notes,
    attachment_names: j.attachmentNames,
    // workers is now in the job_sheet_workers table — see syncJobSheet()
  };
}

// timesheetToRow is no longer used — replaced by syncTimesheet()

function employeeToRow(e: EmployeeRecord, isDeleted: boolean) {
  return {
    employee_key: e.employeeKey,
    employee_id: e.employeeId ?? null,
    full_name: e.fullName,
    first_name: e.firstName ?? null,
    last_name: e.lastName ?? null,
    payroll_name: e.payrollName ?? null,
    preferred_name: e.preferredName ?? null,
    status: e.status ?? null,
    worker_category: e.workerCategory ?? null,
    position_status: e.positionStatus ?? null,
    employment_type: e.employmentType ?? null,
    // type is derived from employment_type — not stored separately
    city: e.city ?? null,
    state: e.state ?? null,
    state_code: e.stateCode ?? null,
    email: e.email ?? null,
    phone: e.phone ?? null,
    address: e.address ?? null,
    notes: e.notes ?? null,
    profile_picture: e.profilePicture ?? null,
    documents: e.documents ?? [],
    source: e.source ?? null,
    is_deleted: isDeleted,
  };
}

function jobCostingToRow(j: JobCostingDraft) {
  return {
    id: j.id,
    title: j.title,
    client: j.client,
    event_name: j.eventName,
    venue: j.venue,
    city_state: j.cityState,
    linked_job_request_id: j.linkedJobRequestId ?? null,
    linked_quote_id: j.linkedQuoteId ?? null,
    linked_job_sheet_id: j.linkedJobSheetId ?? null,
    linked_timesheet_id: j.linkedTimesheetId ?? null,
    linked_rate_card_profile_id: j.linkedRateCardProfileId ?? null,
    payroll_burden: j.payrollBurden,
    overhead_per_hour: j.overheadPerHour,
    target_margin: j.targetMargin,
    ot_pay_multiplier: j.otPayMultiplier,
    dt_pay_multiplier: j.dtPayMultiplier,
    ot_bill_multiplier: j.otBillMultiplier,
    dt_bill_multiplier: j.dtBillMultiplier,
    minimum_hours: j.minimumHours,
    billed_expenses: j.billedExpenses,
    rentals: j.rentals,
    pass_through_markup_revenue: j.passThroughMarkupRevenue,
    actual_travel: j.actualTravel,
    actual_hotels: j.actualHotels,
    actual_per_diem: j.actualPerDiem,
    actual_equipment: j.actualEquipment,
    actual_other_costs: j.actualOtherCosts,
    actual_revenue_collected: j.actualRevenueCollected,
    estimated_job_cost: j.estimatedJobCost,
    lines: j.lines,
    created_at: j.createdAt,
    updated_at: j.updatedAt,
  };
}

function rateCardProfileToRow(p: RateCardProfile) {
  return {
    id: p.id,
    client_name: p.clientName,
    rows: p.rows,
    terms: p.terms,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// ─── Positions ────────────────────────────────────────────────────────────────

function rowToPosition(r: any): Position {
  return {
    id: r.id,
    name: r.name ?? "",
    sortOrder: r.sort_order ?? 0,
    isActive: r.is_active ?? true,
  };
}

export function getPositions(): Position[] {
  return _cache.positions;
}

export function upsertPosition(position: Position): void {
  const idx = _cache.positions.findIndex((p) => p.id === position.id);
  if (idx >= 0) _cache.positions[idx] = position;
  else _cache.positions = [..._cache.positions, position].sort((a, b) => a.sortOrder - b.sortOrder);
  sync("positions", {
    id: position.id,
    name: position.name,
    sort_order: position.sortOrder,
    is_active: position.isActive,
  });
}

export function deletePosition(id: string): void {
  // Soft-delete: mark inactive so existing records keep their position label
  const pos = _cache.positions.find((p) => p.id === id);
  if (!pos) return;
  const updated = { ...pos, isActive: false };
  _cache.positions = _cache.positions.filter((p) => p.id !== id);
  sync("positions", {
    id: updated.id,
    name: updated.name,
    sort_order: updated.sortOrder,
    is_active: false,
  });
}
