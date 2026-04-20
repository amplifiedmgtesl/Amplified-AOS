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
  Specialty,
  Client,
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
  specialties: Specialty[];
  clients: Client[];
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
  specialties: [],
  clients: [],
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
    quoteLinesRes,
    invoiceLinesRes,
    jobRequestsRes,
    jobSheetsRes,
    jobSheetWorkersRes,
    timesheetsRes,
    entriesRes,
    employeesRes,
    jobCostingRes,
    rateProfilesRes,
    rateProfileRowsRes,
    rateStateRes,
    positionsRes,
    specialtiesRes,
    clientsRes,
  ] = await Promise.all([
    supabase.from("calendar_events").select("*"),
    supabase.from("quotes").select("*"),
    supabase.from("quote_draft_workspaces").select("*"),
    supabase.from("invoices").select("*"),
    supabase.from("quote_lines").select("*").order("sort_order"),
    supabase.from("invoice_lines").select("*").order("sort_order"),
    supabase.from("job_requests").select("*"),
    supabase.from("job_sheets").select("*"),
    supabase.from("job_sheet_workers").select("*").order("sort_order"),
    supabase.from("timesheets").select("id, job_sheet_id, title, hide_pay_columns"),
    supabase.from("timesheet_entries").select("*").not("timesheet_id", "is", null),
    fetchAllEmployees(),
    supabase.from("job_costing_drafts").select("*"),
    supabase.from("rate_card_profiles").select("*"),
    supabase.from("rate_card_profile_rows").select("*").order("sort_order"),
    supabase.from("app_rate_state").select("*"),
    supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("clients").select("*").eq("is_active", true).order("name"),
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

  const quoteLinesByQuoteId = new Map<string, any[]>();
  for (const l of (quoteLinesRes.data ?? [])) {
    if (!quoteLinesByQuoteId.has(l.quote_id)) quoteLinesByQuoteId.set(l.quote_id, []);
    quoteLinesByQuoteId.get(l.quote_id)!.push(l);
  }
  _cache.quotes = (quotesRes.data ?? []).map((r) => rowToQuote(r, quoteLinesByQuoteId.get(r.id) ?? []));

  _cache.quoteDraftWorkspaces = (workspacesRes.data ?? []).map(rowToWorkspace);

  const invoiceLinesByInvoiceId = new Map<string, any[]>();
  for (const l of (invoiceLinesRes.data ?? [])) {
    if (!invoiceLinesByInvoiceId.has(l.invoice_id)) invoiceLinesByInvoiceId.set(l.invoice_id, []);
    invoiceLinesByInvoiceId.get(l.invoice_id)!.push(l);
  }
  _cache.invoiceDrafts = (invoicesRes.data ?? []).map((r) => rowToInvoice(r, invoiceLinesByInvoiceId.get(r.id) ?? []));
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

  // Positions and specialties must be in cache BEFORE rate card profiles
  // because rowToRateRow resolves position/specialty names from cache.
  _cache.positions = (positionsRes.data ?? []).map(rowToPosition);
  _cache.specialties = (specialtiesRes.data ?? []).map(rowToSpecialty);
  _cache.clients = (clientsRes.data ?? []).map(rowToClient);

  const profileRowsByProfileId = new Map<string, any[]>();
  for (const r of (rateProfileRowsRes.data ?? [])) {
    if (!profileRowsByProfileId.has(r.profile_id)) profileRowsByProfileId.set(r.profile_id, []);
    profileRowsByProfileId.get(r.profile_id)!.push(r);
  }
  _cache.rateCardProfiles = (rateProfilesRes.data ?? []).map((r) =>
    rowToRateCardProfile(r, profileRowsByProfileId.get(r.id) ?? [])
  );

  const rateStateMap: Record<string, any> = {};
  for (const r of rateStateRes.data ?? []) rateStateMap[r.key] = r.value;
  // rate_rows intentionally not read — app_rate_state is deprecated for rows; use named profiles
  if (rateStateMap["terms"]) _cache.terms = rateStateMap["terms"];
  if (rateStateMap["client_name"]) _cache.clientName = rateStateMap["client_name"];

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
  for (const r of rows) {
    sync("quotes", quoteToRow(r));
    syncQuoteLines(r.id, r.lines);
  }
}

export function upsertQuote(row: QuoteDraft) {
  _cache.quotes = [..._cache.quotes.filter((r) => r.id !== row.id), row];
  sync("quotes", quoteToRow(row));
  syncQuoteLines(row.id, row.lines);
  // Write reverse link back to job request
  if (row.linkedJobRequestId) {
    supabase.from("job_requests").update({ linked_quote_id: row.id }).eq("id", row.linkedJobRequestId).then(() => {});
    _cache.jobRequests = _cache.jobRequests.map((r) =>
      r.id === row.linkedJobRequestId ? { ...r, linkedQuoteId: row.id } : r
    );
  }
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
  for (const r of rows) {
    sync("invoices", invoiceToRow(r));
    syncInvoiceLines(r.id, r.lines);
  }
}

export function upsertInvoiceDraft(row: InvoiceDraft) {
  _cache.invoiceDrafts = [..._cache.invoiceDrafts.filter((r) => r.id !== row.id), row];
  sync("invoices", invoiceToRow(row));
  syncInvoiceLines(row.id, row.lines);
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

export async function deleteJobRequest(id: string): Promise<string | null> {
  const row = _cache.jobRequests.find((r) => r.id === id);
  if (!row) return null;
  if (row.linkedQuoteId) return "Cannot delete — a quote has been built from this job request.";
  const { error } = await supabase.from("job_requests").delete().eq("id", id);
  if (error) return error.message;
  _cache.jobRequests = _cache.jobRequests.filter((r) => r.id !== id);
  return null;
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
  return (data ?? []).map(rowToTimeEntry);
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

export async function pullApprovedTimesheetSummary(jobSheetId: string): Promise<Array<{
  position: string;
  workers: number;
  stdHours: number;
  otHours: number;
  dtHours: number;
  totalHours: number;
  totalPay: number;
}>> {
  const { data, error } = await supabase
    .from("timesheet_entries")
    .select("position, employee_key, std_hours, ot_hours, dt_hours, total_hours, total_pay")
    .eq("job_sheet_id", jobSheetId)
    .eq("status", "approved");
  if (error) { console.error("[db] pullApprovedTimesheetSummary:", error); return []; }
  if (!data || data.length === 0) return [];

  // Group by position, summing hours/pay and counting distinct workers
  const map = new Map<string, {
    linkedKeys: Set<string>;
    unlinkedCount: number;
    stdHours: number;
    otHours: number;
    dtHours: number;
    totalHours: number;
    totalPay: number;
  }>();

  for (const row of data) {
    const pos = (row.position as string) || "Unknown";
    if (!map.has(pos)) {
      map.set(pos, { linkedKeys: new Set(), unlinkedCount: 0, stdHours: 0, otHours: 0, dtHours: 0, totalHours: 0, totalPay: 0 });
    }
    const entry = map.get(pos)!;
    if (row.employee_key) {
      entry.linkedKeys.add(row.employee_key as string);
    } else {
      entry.unlinkedCount++;
    }
    entry.stdHours   += Number(row.std_hours   ?? 0);
    entry.otHours    += Number(row.ot_hours    ?? 0);
    entry.dtHours    += Number(row.dt_hours    ?? 0);
    entry.totalHours += Number(row.total_hours ?? 0);
    entry.totalPay   += Number(row.total_pay   ?? 0);
  }

  return Array.from(map.entries()).map(([position, v]) => ({
    position,
    workers: v.linkedKeys.size + v.unlinkedCount,
    stdHours:   Number(v.stdHours.toFixed(2)),
    otHours:    Number(v.otHours.toFixed(2)),
    dtHours:    Number(v.dtHours.toFixed(2)),
    totalHours: Number(v.totalHours.toFixed(2)),
    totalPay:   Number(v.totalPay.toFixed(2)),
  }));
}

function syncTimesheet(t: Timesheet) {
  // Upsert header (no rows column)
  supabase
    .from("timesheets")
    .upsert({ id: t.id, job_sheet_id: t.jobSheetId, title: t.title, hide_pay_columns: t.hidePayColumns })
    .then(({ error }) => { if (error) console.error("[db] syncTimesheet header error:", error); });

  // Sync only AOS-managed entries (user_id IS NULL).
  // Staff-submitted entries (user_id set) are managed by their own approval flow.
  //
  // Strategy: UPSERT current rows, then delete any stale rows that were removed.
  const aosManagedRows = t.rows.filter((r) => !r.userId);

  if (aosManagedRows.length > 0) {
    const entryRows = aosManagedRows.map((r, idx) => timesheetEntryToRow(r, t.id, t.jobSheetId, idx));
    supabase
      .from("timesheet_entries")
      .upsert(entryRows, { onConflict: "id" })
      .then(({ error }) => { if (error) console.error("[db] syncTimesheet upsert entries error:", error); });
  }
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
  // app_rate_state write intentionally removed — deprecated for rate rows
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
  syncRateCardProfileRows(profile);
}

function syncRateCardProfileRows(profile: RateCardProfile) {
  supabase
    .from("rate_card_profile_rows")
    .delete()
    .eq("profile_id", profile.id)
    .then(() => {
      const rows = profile.rows
        .filter((row) => row.specialtyId)
        .map((row, idx) => ({
          id: `${profile.id}_${idx}`,
          profile_id: profile.id,
          specialty_id: row.specialtyId!,
          hourly:    row.hourly,
          day:       row.day,
          ot_rate:   row.otRate,
          dt_rate:   row.dtRate,
          dt_after:  row.dtAfter,
          travel:    row.travel,
          show:      row.show,
          sort_order: idx,
        }));
      if (rows.length > 0) {
        supabase.from("rate_card_profile_rows").insert(rows).then(({ error }) => {
          if (error) console.error("[db] syncRateCardProfileRows insert error:", error.message);
        });
      }
    });
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

function rowToQuote(r: any, lineRows: any[] = []): QuoteDraft {
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
    lines: lineRows.length > 0 ? lineRows.map(rowToQuoteLine) : (r.lines ?? []),
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

function rowToInvoice(r: any, lineRows: any[] = []): InvoiceDraft {
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
    lines: lineRows.length > 0 ? lineRows.map(rowToInvoiceLine) : (r.lines ?? []),
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
    clientId: r.client_id ?? undefined,
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    venueAddress: r.venue_address ?? "",
    venueZip: r.venue_zip ?? undefined,
    city: r.city ?? "",
    state: r.state ?? "",
    cityState: r.city_state ?? "",
    googleMapsLink: r.google_maps_link ?? "",
    receivedDate: r.received_date ?? "",
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
    linkedQuoteId: r.linked_quote_id ?? undefined,
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
      .map(rowToTimeEntry),
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
    stdHours: Number(r.std_hours ?? 0),
    otHours: Number(r.ot_hours ?? 0),
    dtHours: Number(r.dt_hours ?? 0),
    totalHours: Number(r.total_hours ?? 0),
    stdRate: Number(r.std_rate) || 35,
    otRate: Number(r.ot_rate) || 52,
    dtRate: Number(r.dt_rate) || 70,
    totalPay: Number(r.total_pay ?? 0),
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

function rowToRateRow(pr: any): RateRow {
  const specialty = _cache.specialties.find((s) => s.id === pr.specialty_id);
  const position = specialty ? _cache.positions.find((p) => p.id === specialty.positionId) : null;
  return {
    specialtyId: pr.specialty_id,
    department: position?.name ?? "",
    position:   position?.name ?? "",
    specialty:  specialty?.name ?? "",
    hourly:   pr.hourly   ?? 0,
    day:      pr.day      ?? 0,
    otRate:   pr.ot_rate  ?? 0,
    dtRate:   pr.dt_rate  ?? 0,
    dtAfter:  (pr.dt_after ?? "10") as import("../rates/defaults").TriggerOption,
    travel:   pr.travel   ?? 0,
    show:     pr.show     ?? true,
  };
}

function rowToRateCardProfile(r: any, profileRows: any[]): RateCardProfile {
  const rows = profileRows.length > 0
    ? profileRows.map(rowToRateRow)
    : (r.rows ?? []);   // fallback to JSONB for profiles not yet migrated
  return {
    id: r.id,
    clientId: r.client_id ?? undefined,
    clientName: r.client_name ?? "",
    name: r.name ?? "Standard",
    rows,
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

function rowToQuoteLine(r: any): import("./types").QuoteLine {
  return {
    serviceKey:   r.service_key  ?? "",
    qty:          r.qty          ?? 0,
    hours:        r.hours        ?? 0,
    holidayHours: r.holiday_hours ?? 0,
    travel:       r.travel       ?? 0,
    baseHourly:   r.base_hourly  ?? 0,
    baseDay:      r.base_day     ?? 0,
    otRate:       r.ot_rate      ?? 0,
    dtRate:       r.dt_rate      ?? 0,
    rule:         r.rule         ?? "",
    total:        r.total        ?? 0,
    department:   r.department   ?? undefined,
    specialty:    r.specialty    ?? undefined,
    shiftLabel:   r.shift_label  ?? undefined,
    quoteDate:    r.quote_date   ?? undefined,
    startTime:    r.start_time   ?? undefined,
    endTime:      r.end_time     ?? undefined,
    rateMode:     r.rate_mode    ?? undefined,
  };
}

function rowToInvoiceLine(r: any): import("./types").QuoteLine {
  return rowToQuoteLine(r);
}

function quoteLineToRow(quoteId: string, l: import("./types").QuoteLine, index: number) {
  return {
    id:            `${quoteId}_${index}`,
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
    department:    l.department  ?? null,
    specialty:     l.specialty   ?? null,
    shift_label:   l.shiftLabel  ?? null,
    quote_date:    l.quoteDate   ?? null,
    start_time:    l.startTime   ?? null,
    end_time:      l.endTime     ?? null,
    rate_mode:     l.rateMode    ?? null,
  };
}

function invoiceLineToRow(invoiceId: string, l: import("./types").QuoteLine, index: number) {
  return {
    id:            `${invoiceId}_${index}`,
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
    department:    l.department  ?? null,
    specialty:     l.specialty   ?? null,
    shift_label:   l.shiftLabel  ?? null,
    quote_date:    l.quoteDate   ?? null,
    start_time:    l.startTime   ?? null,
    end_time:      l.endTime     ?? null,
    rate_mode:     l.rateMode    ?? null,
  };
}

function syncQuoteLines(quoteId: string, lines: import("./types").QuoteLine[]) {
  supabase
    .from("quote_lines")
    .delete()
    .eq("quote_id", quoteId)
    .then(({ error }) => {
      if (error) { console.error("[db] delete quote_lines error:", error); return; }
      if (lines.length === 0) return;
      supabase
        .from("quote_lines")
        .insert(lines.map((l, i) => quoteLineToRow(quoteId, l, i)))
        .then(({ error: e2 }) => {
          if (e2) console.error("[db] insert quote_lines error:", e2);
        });
    });
}

function syncInvoiceLines(invoiceId: string, lines: import("./types").QuoteLine[]) {
  supabase
    .from("invoice_lines")
    .delete()
    .eq("invoice_id", invoiceId)
    .then(({ error }) => {
      if (error) { console.error("[db] delete invoice_lines error:", error); return; }
      if (lines.length === 0) return;
      supabase
        .from("invoice_lines")
        .insert(lines.map((l, i) => invoiceLineToRow(invoiceId, l, i)))
        .then(({ error: e2 }) => {
          if (e2) console.error("[db] insert invoice_lines error:", e2);
        });
    });
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
    client_id: j.clientId ?? null,
    client: j.client,
    event_name: j.eventName,
    venue: j.venue,
    venue_address: j.venueAddress,
    venue_zip: j.venueZip ?? null,
    city: j.city,
    state: j.state,
    city_state: j.cityState,
    google_maps_link: j.googleMapsLink,
    received_date: j.receivedDate || null,
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
    linked_quote_id: j.linkedQuoteId ?? null,
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
    client_id: p.clientId ?? null,
    client_name: p.clientName,
    name: p.name ?? "Standard",
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

// ─── Specialties ──────────────────────────────────────────────────────────────

function rowToSpecialty(r: any): Specialty {
  return {
    id: r.id,
    positionId: r.position_id,
    name: r.name ?? "",
    sortOrder: r.sort_order ?? 0,
    isActive: r.is_active ?? true,
  };
}

export function getSpecialties(): Specialty[] {
  return _cache.specialties;
}

export function getSpecialtiesByPosition(positionId: string): Specialty[] {
  return _cache.specialties
    .filter((s) => s.positionId === positionId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function upsertSpecialty(specialty: Specialty): void {
  const idx = _cache.specialties.findIndex((s) => s.id === specialty.id);
  if (idx >= 0) _cache.specialties[idx] = specialty;
  else _cache.specialties = [..._cache.specialties, specialty].sort((a, b) => a.sortOrder - b.sortOrder);
  sync("specialties", {
    id: specialty.id,
    position_id: specialty.positionId,
    name: specialty.name,
    sort_order: specialty.sortOrder,
    is_active: specialty.isActive,
  });
}

export function deleteSpecialty(id: string): void {
  const s = _cache.specialties.find((x) => x.id === id);
  if (!s) return;
  _cache.specialties = _cache.specialties.filter((x) => x.id !== id);
  sync("specialties", {
    id: s.id,
    position_id: s.positionId,
    name: s.name,
    sort_order: s.sortOrder,
    is_active: false,
  });
}

// ─── Clients ─────────────────────────────────────────────────────────────────

function rowToClient(r: any): Client {
  return {
    id: r.id,
    name: r.name ?? "",
    contactName: r.contact_name ?? undefined,
    billTo: r.bill_to ?? undefined,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zip: r.zip ?? undefined,
    notes: r.notes ?? undefined,
    isActive: r.is_active ?? true,
  };
}

export function getClients(): Client[] {
  return _cache.clients;
}

export function upsertClient(c: Client): void {
  const idx = _cache.clients.findIndex((x) => x.id === c.id);
  if (idx >= 0) _cache.clients[idx] = c;
  else _cache.clients = [..._cache.clients, c].sort((a, b) => a.name.localeCompare(b.name));
  sync("clients", {
    id: c.id, name: c.name, contact_name: c.contactName ?? null, bill_to: c.billTo ?? null,
    email: c.email ?? null, phone: c.phone ?? null,
    address: c.address ?? null, city: c.city ?? null, state: c.state ?? null,
    zip: c.zip ?? null, notes: c.notes ?? null, is_active: c.isActive,
  });
}

export async function mergeClients(sourceId: string, targetId: string): Promise<string | null> {
  const source = _cache.clients.find((c) => c.id === sourceId);
  const target = _cache.clients.find((c) => c.id === targetId);
  if (!source || !target) return "Client not found.";
  const tables = [
    { table: "quotes",             col: "client" },
    { table: "invoices",           col: "client" },
    { table: "job_requests",       col: "client" },
    { table: "calendar_events",    col: "client" },
    { table: "job_sheets",         col: "client" },
    { table: "job_costing_drafts", col: "client" },
    { table: "rate_card_profiles", col: "client_name" },
  ];
  for (const { table, col } of tables) {
    const { error } = await supabase.from(table).update({ [col]: target.name }).eq(col, source.name);
    if (error) return `Failed updating ${table}: ${error.message}`;
  }
  // Also reassign client_id on normalized tables
  await supabase.from("job_requests").update({ client_id: target.id }).eq("client_id", source.id);
  await supabase.from("rate_card_profiles").update({ client_id: target.id }).eq("client_id", source.id);
  for (const t of ["quotes", "invoices"] as const) {
    const key = t === "quotes" ? "quotes" : "invoiceDrafts";
    (_cache as any)[key] = (_cache as any)[key].map((r: any) =>
      r.client === source.name ? { ...r, client: target.name } : r
    );
  }
  // Soft-delete source
  _cache.clients = _cache.clients.filter((c) => c.id !== sourceId);
  sync("clients", { id: sourceId, name: source.name, is_active: false });
  return null;
}
