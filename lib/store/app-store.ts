/**
 * lib/store/app-store.ts
 *
 * Public data API used by all components.
 * Reads come from the in-memory cache (synchronous, no component changes needed).
 * Writes update the cache immediately and sync to Supabase in the background.
 *
 * UI-only state (active selections, transient seeds) stays in localStorage
 * because it is per-browser and doesn't need to be shared across devices.
 */

import * as db from "./db";
import { loadJSON, saveJSON } from "./local";
import { blankTimeEntry, computeTimeEntry } from "./timekeeping";
import type {
  CalendarEvent,
  QuoteDraft,
  InvoiceDraft,
  JobRequest,
  JobSheet,
  Timesheet,
  EmployeeRecord,
  JobCostingDraft,
  JobSheetWorker,
} from "./types";

// ─── Calendar Events ──────────────────────────────────────────────────────────

export function loadManualEvents(): CalendarEvent[] { return db.getManualEvents(); }
export function saveManualEvents(rows: CalendarEvent[]) { db.setManualEvents(rows); }
export function upsertManualEvent(row: CalendarEvent) { db.upsertManualEvent(row); }
export function loadDeletedEventIds(): string[] { return db.getDeletedEventIds(); }
export function deleteEventById(id: string) { db.deleteEventById(id); }
export function undeleteAllEvents() { db.undeleteAllEvents(); }

export function loadEventProfiles() { return db.getEventProfiles(); }
export function saveEventProfile(
  eventId: string,
  data: { notes: string; attachmentNames: string[] }
) { db.saveEventProfile(eventId, data); }

// ─── Quotes ───────────────────────────────────────────────────────────────────

// loadQuotes (sync, cache-backed) is kept for legacy invoice-builder reads.
// New code paths use lib/store/quotes.ts (async, direct to Supabase).
// Goes away when Phase C ships.
export function loadQuotes(): QuoteDraft[] { return db.getQuotes(); }

// Active quote — UI state, stays in localStorage
export function setActiveQuote(id: string) { saveJSON("aes_active_quote_v1", id); }
export function getActiveQuote(): string | null { return loadJSON<string | null>("aes_active_quote_v1", null); }

// ─── Invoices ─────────────────────────────────────────────────────────────────

export function loadInvoiceDrafts(): InvoiceDraft[] { return db.getInvoiceDrafts(); }
export function saveInvoiceDrafts(rows: InvoiceDraft[]) { db.setInvoiceDrafts(rows); }
export function upsertInvoiceDraft(row: InvoiceDraft) { return db.upsertInvoiceDraft(row); }

// Active invoice — UI state, stays in localStorage
export function setActiveInvoice(id: string) { saveJSON("aes_active_invoice_v2", id); }
export function getActiveInvoice(): string | null {
  return loadJSON<string | null>("aes_active_invoice_v2", null);
}

// ─── Job Requests ─────────────────────────────────────────────────────────────

export function loadJobRequests(): JobRequest[] { return db.getJobRequests(); }
export function saveJobRequests(rows: JobRequest[]) { db.setJobRequests(rows); }
export function upsertJobRequest(row: JobRequest) { db.upsertJobRequest(row); }
export async function deleteJobRequest(id: string): Promise<string | null> { return db.deleteJobRequest(id); }

// ─── Job Sheets ───────────────────────────────────────────────────────────────

export function loadJobSheets(): JobSheet[] { return db.getJobSheets(); }
export function saveJobSheets(rows: JobSheet[]) { db.setJobSheets(rows); }
export function upsertJobSheet(row: JobSheet) { db.upsertJobSheet(row); }

export function setActiveJobSheet(id: string) { saveJSON("aes_active_job_sheet_v2", id); }
export function getActiveJobSheet(): string | null {
  return loadJSON<string | null>("aes_active_job_sheet_v2", null);
}

// ─── Timesheets ───────────────────────────────────────────────────────────────

export function loadTimesheets(): Timesheet[] { return db.getTimesheets(); }
export function saveTimesheets(rows: Timesheet[]) { db.setTimesheets(rows); }
export function upsertTimesheet(row: Timesheet) { db.upsertTimesheet(row); }

export async function getPendingStaffEntries(jobSheetId: string) { return db.getPendingStaffEntries(jobSheetId); }
export async function getAllStaffReviewEntries() { return db.getAllStaffReviewEntries(); }
export async function ensureTimesheetForJob(jobSheetId: string, jobTitle?: string) { return db.ensureTimesheetForJob(jobSheetId, jobTitle); }
export async function getApprovedEntriesForJob(jobSheetId: string) { return db.getApprovedEntriesForJob(jobSheetId); }
export async function getEntryCountsForJob(jobSheetId: string) { return db.getEntryCountsForJob(jobSheetId); }
export async function approveStaffEntry(entryId: string, timesheetId: string) { return db.approveStaffEntry(entryId, timesheetId); }
export async function rejectStaffEntry(entryId: string) { return db.rejectStaffEntry(entryId); }
export async function setEntryApproved(entryId: string) { return db.setEntryApproved(entryId); }
export async function pullApprovedTimesheetSummary(jobSheetId: string) { return db.pullApprovedTimesheetSummary(jobSheetId); }

export function getTimesheetByJobSheetId(jobSheetId: string): Timesheet | null {
  return db.getTimesheets().find((t) => t.jobSheetId === jobSheetId) || null;
}

// ─── Phase 1: job_id-anchored API (prefer these over the *ByJobSheetId twins)
export function getTimesheetByJobId(jobId: string): Timesheet | null {
  return db.getTimesheets().find((t) => t.jobId === jobId) || null;
}
export async function getPendingStaffEntriesByJobId(jobId: string) {
  return db.getPendingStaffEntriesByJobId(jobId);
}
export async function getApprovedEntriesForJobByJobId(jobId: string) {
  return db.getApprovedEntriesForJobByJobId(jobId);
}
export async function getEntryCountsForJobByJobId(jobId: string) {
  return db.getEntryCountsForJobByJobId(jobId);
}
export async function ensureTimesheetForJobRequest(
  jobId: string,
  opts: { jobTitle?: string; jobSheetId?: string | null } = {},
) {
  return db.ensureTimesheetForJobRequest(jobId, opts);
}

// Tracks the user's last-picked job on the timekeeping screen (replaces
// getActiveJobSheet for the new flow).
export function setActiveJob(jobId: string) { saveJSON("aes_active_job_v1", jobId); }
export function getActiveJob(): string | null {
  return loadJSON<string | null>("aes_active_job_v1", null);
}

export function addWorkerToTimesheet(jobSheetId: string, worker: JobSheetWorker) {
  const existing = getTimesheetByJobSheetId(jobSheetId);
  const base = existing || {
    id: `timesheet-${jobSheetId}`,
    jobSheetId,
    title: "Timekeeping Sheet",
    hidePayColumns: false,
    rows: [],
  };
  const exists = base.rows.some(
    (r) =>
      (r.email && worker.email && r.email === worker.email) ||
      `${r.firstName} ${r.lastName}`.trim() === worker.fullName.trim()
  );
  if (exists) return;
  const row = computeTimeEntry({
    ...blankTimeEntry(`ts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    position: worker.role || "Crew",
    firstName: worker.firstName || worker.fullName.split(" ")[0] || "",
    lastName: worker.lastName || worker.fullName.split(" ").slice(1).join(" "),
    phone: worker.phone || "",
    email: worker.email || "",
    employeeKey: worker.employeeKey || null,
    // Entries linked to an employee start as "submitted" so the employee
    // can review and the admin must explicitly approve before it's locked
    status: worker.employeeKey ? "submitted" : null,
  });
  upsertTimesheet({ ...base, rows: [...base.rows, row] });
}

// ─── Employees ────────────────────────────────────────────────────────────────

export function loadEmployees(): EmployeeRecord[] { return db.getEmployees(); }
export function saveEmployees(rows: EmployeeRecord[]) { db.setEmployees(rows); }
export function upsertEmployee(row: EmployeeRecord) { db.upsertEmployee(row); }
export function deleteEmployee(employeeKey: string) { markEmployeeDeleted(employeeKey); }
export function loadDeletedEmployeeKeys(): string[] { return db.getDeletedEmployeeKeys(); }
export function markEmployeeDeleted(employeeKey: string) { db.markEmployeeDeleted(employeeKey); }
export async function bulkUpsertEmployees(rows: EmployeeRecord[]) { return db.bulkUpsertEmployees(rows); }

export function setActiveEmployee(employeeKey: string | null) {
  saveJSON("aes_active_employee_v1", employeeKey);
}
export function getActiveEmployee(): string | null {
  return loadJSON<string | null>("aes_active_employee_v1", null);
}

// ─── Job Costing ──────────────────────────────────────────────────────────────

export function loadJobCostingDrafts(): JobCostingDraft[] { return db.getJobCostingDrafts(); }
export function saveJobCostingDrafts(rows: JobCostingDraft[]) { db.setJobCostingDrafts(rows); }
export function upsertJobCostingDraft(row: JobCostingDraft) { db.upsertJobCostingDraft(row); }

export function setActiveJobCosting(id: string) { saveJSON("aes_active_job_costing_v1", id); }
export function getActiveJobCosting(): string | null {
  return loadJSON<string | null>("aes_active_job_costing_v1", null);
}

// ─── Positions ────────────────────────────────────────────────────────────────

import type { Position, Specialty } from "./types";

export function loadPositions(): Position[] { return db.getPositions(); }
export function upsertPosition(row: Position) { db.upsertPosition(row); }
export function deletePosition(id: string) { db.deletePosition(id); }

// ─── Specialties ──────────────────────────────────────────────────────────────

export function loadSpecialties(): Specialty[] { return db.getSpecialties(); }
export function getSpecialtiesByPosition(positionId: string): Specialty[] { return db.getSpecialtiesByPosition(positionId); }
export function upsertSpecialty(row: Specialty) { db.upsertSpecialty(row); }
export function deleteSpecialty(id: string) { db.deleteSpecialty(id); }

// ─── Clients ─────────────────────────────────────────────────────────────────

import type { Client } from "./types";

export function loadClients(): Client[] { return db.getClients(); }
export function upsertClient(row: Client) { db.upsertClient(row); }
export async function mergeClients(sourceId: string, targetId: string): Promise<string | null> {
  return db.mergeClients(sourceId, targetId);
}

/** Returns active position names as a flat string array — drop-in for old POSITIONS constant. */
export function positionNames(): string[] {
  const names = db.getPositions().map((p) => p.name);
  return names.length > 0 ? names : [
    "Stagehand","Stagehand Lead","Rigger","Head Rigger",
    "Audio Technician","Lighting Technician","Video Technician",
    "Forklift Operator","Camera Operator","Operations",
    "Lead","Heavy Equipment Op","Aerial Lift Operator","General Labor","Other",
  ];
}
