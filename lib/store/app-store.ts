
import { loadJSON, saveJSON } from "./local";
import type { CalendarEvent, QuoteDraft, InvoiceDraft, JobRequest, JobSheet, Timesheet, EmployeeRecord, JobCostingDraft } from "./types";

const KEYS = {
  manualEvents: "aes_manual_events_v2",
  deletedEventIds: "aes_deleted_event_ids_v1",
  eventProfiles: "aes_event_profiles_v1",
  quotes: "aes_quotes_v2",
  invoiceDrafts: "aes_invoice_drafts_v2",
  activeInvoice: "aes_active_invoice_v2",
  quoteSeed: "aes_quote_seed_v2",
  activeQuote: "aes_active_quote_v1",
  quoteDrafts: "aes_quote_drafts_v1",
  activeQuoteDraft: "aes_active_quote_draft_v1",
  jobRequests: "aes_job_requests_v2",
  jobSheets: "aes_job_sheets_v2",
  activeJobSheet: "aes_active_job_sheet_v2",
  timesheets: "aes_timesheets_v1",
  employees: "aes_employees_v1",
  activeEmployee: "aes_active_employee_v1",
  deletedEmployeeKeys: "aes_deleted_employee_keys_v1",
  jobCostingDrafts: "aes_job_costing_drafts_v1",
  activeJobCosting: "aes_active_job_costing_v1"
};

export function loadManualEvents(): CalendarEvent[] { return loadJSON(KEYS.manualEvents, []); }
export function saveManualEvents(rows: CalendarEvent[]) { saveJSON(KEYS.manualEvents, rows); }
export function upsertManualEvent(row: CalendarEvent) {
  const rows = loadManualEvents();
  saveManualEvents([...rows.filter(r => r.id !== row.id), row]);
}
export function loadDeletedEventIds(): string[] { return loadJSON(KEYS.deletedEventIds, []); }
export function deleteEventById(id: string) {
  const ids = loadDeletedEventIds();
  if (!ids.includes(id)) saveJSON(KEYS.deletedEventIds, [...ids, id]);
  saveManualEvents(loadManualEvents().filter(e => e.id !== id));
}
export function undeleteAllEvents() { saveJSON(KEYS.deletedEventIds, []); }

export function loadEventProfiles(): Record<string, {notes:string; attachmentNames:string[]}> { return loadJSON(KEYS.eventProfiles, {}); }
export function saveEventProfile(eventId: string, data: {notes:string; attachmentNames:string[]}) {
  const all = loadEventProfiles();
  all[eventId] = data;
  saveJSON(KEYS.eventProfiles, all);
}

export function loadQuotes(): QuoteDraft[] { return loadJSON(KEYS.quotes, []); }
export function saveQuotes(rows: QuoteDraft[]) { saveJSON(KEYS.quotes, rows); }
export function upsertQuote(row: QuoteDraft) {
  const rows = loadQuotes();
  saveQuotes([...rows.filter(r => r.id !== row.id), row]);
}

export function loadInvoiceDrafts(): InvoiceDraft[] { return loadJSON(KEYS.invoiceDrafts, []); }
export function saveInvoiceDrafts(rows: InvoiceDraft[]) { saveJSON(KEYS.invoiceDrafts, rows); }
export function upsertInvoiceDraft(row: InvoiceDraft) {
  const rows = loadInvoiceDrafts();
  saveInvoiceDrafts([...rows.filter(r => r.id !== row.id), row]);
}
export function setActiveInvoice(id: string) { saveJSON(KEYS.activeInvoice, id); }
export function getActiveInvoice(): string | null { return loadJSON<string | null>(KEYS.activeInvoice, null); }

export function setQuoteSeed(seed: Partial<QuoteDraft> | null) { saveJSON(KEYS.quoteSeed, seed); }
export function getQuoteSeed(): Partial<QuoteDraft> | null { return loadJSON<Partial<QuoteDraft> | null>(KEYS.quoteSeed, null); }

export function loadJobRequests(): JobRequest[] { return loadJSON(KEYS.jobRequests, []); }
export function saveJobRequests(rows: JobRequest[]) { saveJSON(KEYS.jobRequests, rows); }
export function upsertJobRequest(row: JobRequest) {
  const rows = loadJobRequests();
  saveJobRequests([...rows.filter(r => r.id !== row.id), row]);
}

export function loadJobSheets(): JobSheet[] { return loadJSON(KEYS.jobSheets, []); }
export function saveJobSheets(rows: JobSheet[]) { saveJSON(KEYS.jobSheets, rows); }
export function upsertJobSheet(row: JobSheet) {
  const rows = loadJobSheets();
  saveJobSheets([...rows.filter(r => r.id !== row.id), row]);
}
export function setActiveJobSheet(id: string) { saveJSON(KEYS.activeJobSheet, id); }
export function getActiveJobSheet(): string | null { return loadJSON<string | null>(KEYS.activeJobSheet, null); }

export function loadTimesheets(): Timesheet[] { return loadJSON(KEYS.timesheets, []); }
export function saveTimesheets(rows: Timesheet[]) { saveJSON(KEYS.timesheets, rows); }
export function upsertTimesheet(row: Timesheet) {
  const rows = loadTimesheets();
  saveTimesheets([...rows.filter(r => r.id !== row.id), row]);
}
export function getTimesheetByJobSheetId(jobSheetId: string): Timesheet | null {
  return loadTimesheets().find(t => t.jobSheetId === jobSheetId) || null;
}

export function loadEmployees(): EmployeeRecord[] { return loadJSON(KEYS.employees, []); }
export function saveEmployees(rows: EmployeeRecord[]) { saveJSON(KEYS.employees, rows); }
export function upsertEmployee(row: EmployeeRecord) {
  const rows = loadEmployees();
  saveEmployees([...rows.filter(r => r.employeeKey !== row.employeeKey), row]);
}
export function deleteEmployee(employeeKey: string) {
  markEmployeeDeleted(employeeKey);
}
export function setActiveEmployee(employeeKey: string | null) { saveJSON(KEYS.activeEmployee, employeeKey); }
export function getActiveEmployee(): string | null { return loadJSON<string | null>(KEYS.activeEmployee, null); }


export function loadDeletedEmployeeKeys(): string[] { return loadJSON(KEYS.deletedEmployeeKeys, []); }
export function markEmployeeDeleted(employeeKey: string) {
  const keys = loadDeletedEmployeeKeys();
  if (!keys.includes(employeeKey)) saveJSON(KEYS.deletedEmployeeKeys, [...keys, employeeKey]);
  saveEmployees(loadEmployees().filter(e => e.employeeKey !== employeeKey));
}


import { blankTimeEntry, computeTimeEntry } from "./timekeeping";
import type { JobSheetWorker } from "./types";

export function addWorkerToTimesheet(jobSheetId: string, worker: JobSheetWorker) {
  const existing = getTimesheetByJobSheetId(jobSheetId);
  const base = existing || { id: `timesheet-${jobSheetId}`, jobSheetId, title: "Timekeeping Sheet", hidePayColumns: false, rows: [] };
  const exists = base.rows.some((r) => (r.email && worker.email && r.email === worker.email) || `${r.firstName} ${r.lastName}`.trim() === worker.fullName.trim());
  if (exists) return;
  const row = computeTimeEntry({
    ...blankTimeEntry(`ts-${Date.now()}-${Math.random().toString(36).slice(2,7)}`),
    position: worker.role || "Crew",
    firstName: worker.firstName || worker.fullName.split(" ")[0] || "",
    lastName: worker.lastName || worker.fullName.split(" ").slice(1).join(" "),
    phone: worker.phone || "",
    email: worker.email || "",
  });
  upsertTimesheet({ ...base, rows: [...base.rows, row] });
}


export function setActiveQuote(id: string) { saveJSON(KEYS.activeQuote, id); }
export function getActiveQuote(): string | null { return loadJSON<string | null>(KEYS.activeQuote, null); }


export type QuoteDraftWorkspace = {
  id: string;
  name: string;
  updatedAt: string;
  data: any;
};

export function loadQuoteDraftWorkspaces(): QuoteDraftWorkspace[] {
  return loadJSON(KEYS.quoteDrafts, []);
}
export function saveQuoteDraftWorkspaces(rows: QuoteDraftWorkspace[]) {
  saveJSON(KEYS.quoteDrafts, rows);
}
export function upsertQuoteDraftWorkspace(row: QuoteDraftWorkspace) {
  const rows = loadQuoteDraftWorkspaces();
  const next = [row, ...rows.filter((r) => r.id !== row.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  saveQuoteDraftWorkspaces(next);
}
export function setActiveQuoteDraft(id: string) { saveJSON(KEYS.activeQuoteDraft, id); }
export function getActiveQuoteDraft(): string | null { return loadJSON<string | null>(KEYS.activeQuoteDraft, null); }


export function loadJobCostingDrafts(): JobCostingDraft[] { return loadJSON(KEYS.jobCostingDrafts, []); }
export function saveJobCostingDrafts(rows: JobCostingDraft[]) { saveJSON(KEYS.jobCostingDrafts, rows); }
export function upsertJobCostingDraft(row: JobCostingDraft) {
  const rows = loadJobCostingDrafts();
  saveJobCostingDrafts([...rows.filter(r => r.id !== row.id), row]);
}
export function setActiveJobCosting(id: string) { saveJSON(KEYS.activeJobCosting, id); }
export function getActiveJobCosting(): string | null { return loadJSON<string | null>(KEYS.activeJobCosting, null); }
