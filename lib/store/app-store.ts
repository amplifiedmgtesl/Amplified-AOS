import { loadJSON, saveJSON } from "./local";
import { STORAGE_KEYS } from "./storage-config";
import type { CalendarEvent, QuoteDraft, InvoiceDraft, JobRequest, JobSheet, Timesheet, EmployeeRecord, JobCostingDraft } from "./types";

export function loadManualEvents(): CalendarEvent[] { return loadJSON(STORAGE_KEYS.manualEvents, []); }
export function saveManualEvents(rows: CalendarEvent[]) { saveJSON(STORAGE_KEYS.manualEvents, rows); }
export function upsertManualEvent(row: CalendarEvent) {
  const rows = loadManualEvents();
  saveManualEvents([...rows.filter(r => r.id !== row.id), row]);
}
export function loadDeletedEventIds(): string[] { return loadJSON(STORAGE_KEYS.deletedEventIds, []); }
export function deleteEventById(id: string) {
  const ids = loadDeletedEventIds();
  if (!ids.includes(id)) saveJSON(STORAGE_KEYS.deletedEventIds, [...ids, id]);
  saveManualEvents(loadManualEvents().filter(e => e.id !== id));
}
export function undeleteAllEvents() { saveJSON(STORAGE_KEYS.deletedEventIds, []); }

export function loadEventProfiles(): Record<string, {notes:string; attachmentNames:string[]}> { return loadJSON(STORAGE_KEYS.eventProfiles, {}); }
export function saveEventProfile(eventId: string, data: {notes:string; attachmentNames:string[]}) {
  const all = loadEventProfiles();
  all[eventId] = data;
  saveJSON(STORAGE_KEYS.eventProfiles, all);
}

export function loadQuotes(): QuoteDraft[] { return loadJSON(STORAGE_KEYS.quotes, []); }
export function saveQuotes(rows: QuoteDraft[]) { saveJSON(STORAGE_KEYS.quotes, rows); }
export function upsertQuote(row: QuoteDraft) {
  const rows = loadQuotes();
  saveQuotes([...rows.filter(r => r.id !== row.id), row]);
}

export function loadInvoiceDrafts(): InvoiceDraft[] { return loadJSON(STORAGE_KEYS.invoiceDrafts, []); }
export function saveInvoiceDrafts(rows: InvoiceDraft[]) { saveJSON(STORAGE_KEYS.invoiceDrafts, rows); }
export function upsertInvoiceDraft(row: InvoiceDraft) {
  const rows = loadInvoiceDrafts();
  saveInvoiceDrafts([...rows.filter(r => r.id !== row.id), row]);
}
export function setActiveInvoice(id: string) { saveJSON(STORAGE_KEYS.activeInvoice, id); }
export function getActiveInvoice(): string | null { return loadJSON<string | null>(STORAGE_KEYS.activeInvoice, null); }

export function setQuoteSeed(seed: Partial<QuoteDraft> | null) { saveJSON(STORAGE_KEYS.quoteSeed, seed); }
export function getQuoteSeed(): Partial<QuoteDraft> | null { return loadJSON<Partial<QuoteDraft> | null>(STORAGE_KEYS.quoteSeed, null); }

export function loadJobRequests(): JobRequest[] { return loadJSON(STORAGE_KEYS.jobRequests, []); }
export function saveJobRequests(rows: JobRequest[]) { saveJSON(STORAGE_KEYS.jobRequests, rows); }
export function upsertJobRequest(row: JobRequest) {
  const rows = loadJobRequests();
  saveJobRequests([...rows.filter(r => r.id !== row.id), row]);
}

export function loadJobSheets(): JobSheet[] { return loadJSON(STORAGE_KEYS.jobSheets, []); }
export function saveJobSheets(rows: JobSheet[]) { saveJSON(STORAGE_KEYS.jobSheets, rows); }
export function upsertJobSheet(row: JobSheet) {
  const rows = loadJobSheets();
  saveJobSheets([...rows.filter(r => r.id !== row.id), row]);
}
export function setActiveJobSheet(id: string) { saveJSON(STORAGE_KEYS.activeJobSheet, id); }
export function getActiveJobSheet(): string | null { return loadJSON<string | null>(STORAGE_KEYS.activeJobSheet, null); }

export function loadTimesheets(): Timesheet[] { return loadJSON(STORAGE_KEYS.timesheets, []); }
export function saveTimesheets(rows: Timesheet[]) { saveJSON(STORAGE_KEYS.timesheets, rows); }
export function upsertTimesheet(row: Timesheet) {
  const rows = loadTimesheets();
  saveTimesheets([...rows.filter(r => r.id !== row.id), row]);
}
export function getTimesheetByJobSheetId(jobSheetId: string): Timesheet | null {
  return loadTimesheets().find(t => t.jobSheetId === jobSheetId) || null;
}

export function loadEmployees(): EmployeeRecord[] { return loadJSON(STORAGE_KEYS.employees, []); }
export function saveEmployees(rows: EmployeeRecord[]) { saveJSON(STORAGE_KEYS.employees, rows); }
export function upsertEmployee(row: EmployeeRecord) {
  const rows = loadEmployees();
  saveEmployees([...rows.filter(r => r.employeeKey !== row.employeeKey), row]);
}
export function deleteEmployee(employeeKey: string) {
  markEmployeeDeleted(employeeKey);
}
export function setActiveEmployee(employeeKey: string | null) { saveJSON(STORAGE_KEYS.activeEmployee, employeeKey); }
export function getActiveEmployee(): string | null { return loadJSON<string | null>(STORAGE_KEYS.activeEmployee, null); }

export function loadDeletedEmployeeKeys(): string[] { return loadJSON(STORAGE_KEYS.deletedEmployeeKeys, []); }
export function markEmployeeDeleted(employeeKey: string) {
  const keys = loadDeletedEmployeeKeys();
  if (!keys.includes(employeeKey)) saveJSON(STORAGE_KEYS.deletedEmployeeKeys, [...keys, employeeKey]);
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

export function setActiveQuote(id: string) { saveJSON(STORAGE_KEYS.activeQuote, id); }
export function getActiveQuote(): string | null { return loadJSON<string | null>(STORAGE_KEYS.activeQuote, null); }

export type QuoteDraftWorkspace = {
  id: string;
  name: string;
  updatedAt: string;
  data: any;
};

export function loadQuoteDraftWorkspaces(): QuoteDraftWorkspace[] {
  return loadJSON(STORAGE_KEYS.quoteDrafts, []);
}
export function saveQuoteDraftWorkspaces(rows: QuoteDraftWorkspace[]) {
  saveJSON(STORAGE_KEYS.quoteDrafts, rows);
}
export function upsertQuoteDraftWorkspace(row: QuoteDraftWorkspace) {
  const rows = loadQuoteDraftWorkspaces();
  const next = [row, ...rows.filter((r) => r.id !== row.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  saveQuoteDraftWorkspaces(next);
}
export function setActiveQuoteDraft(id: string) { saveJSON(STORAGE_KEYS.activeQuoteDraft, id); }
export function getActiveQuoteDraft(): string | null { return loadJSON<string | null>(STORAGE_KEYS.activeQuoteDraft, null); }

export function loadJobCostingDrafts(): JobCostingDraft[] { return loadJSON(STORAGE_KEYS.jobCostingDrafts, []); }
export function saveJobCostingDrafts(rows: JobCostingDraft[]) { saveJSON(STORAGE_KEYS.jobCostingDrafts, rows); }
export function upsertJobCostingDraft(row: JobCostingDraft) {
  const rows = loadJobCostingDrafts();
  saveJobCostingDrafts([...rows.filter(r => r.id !== row.id), row]);
}
export function setActiveJobCosting(id: string) { saveJSON(STORAGE_KEYS.activeJobCosting, id); }
export function getActiveJobCosting(): string | null { return loadJSON<string | null>(STORAGE_KEYS.activeJobCosting, null); }
