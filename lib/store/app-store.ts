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
import type {
  CalendarEvent,
  QuoteDraft,
  InvoiceDraft,
  JobRequest,
  JobSheet,
  Timesheet,
  EmployeeRecord,
  JobCostingDraft,
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

// ─── Job Sheets (decommissioned 2026-06-11 — read-only history) ──────────────
// The job_sheets table is kept as inert history; legacy timesheets, entries,
// job-costing drafts, and employee job-history reads still reference it.
// All write paths were removed with the Job Sheets screens.

export function loadJobSheets(): JobSheet[] { return db.getJobSheets(); }

// ─── Timesheets ───────────────────────────────────────────────────────────────

export function loadTimesheets(): Timesheet[] { return db.getTimesheets(); }
export function saveTimesheets(rows: Timesheet[]) { db.setTimesheets(rows); }
export function upsertTimesheet(row: Timesheet) { db.upsertTimesheet(row); }

export async function getAllStaffReviewEntries() { return db.getAllStaffReviewEntries(); }
export async function approveStaffEntry(entryId: string, timesheetId: string) { return db.approveStaffEntry(entryId, timesheetId); }
export async function rejectStaffEntry(entryId: string) { return db.rejectStaffEntry(entryId); }
export async function setEntryApproved(entryId: string) { return db.setEntryApproved(entryId); }
export async function setEntrySubmitted(entryId: string) { return db.setEntrySubmitted(entryId); }

// Read-only legacy lookup — job-costing drafts may still link a job_sheet.
export function getTimesheetByJobSheetId(jobSheetId: string): Timesheet | null {
  return db.getTimesheets().find((t) => t.jobSheetId === jobSheetId) || null;
}

// ─── Job_id-anchored API (canonical) ─────────────────────────────────────────
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
  opts: { jobTitle?: string } = {},
) {
  return db.ensureTimesheetForJobRequest(jobId, opts);
}

// Tracks the user's last-picked job on the timekeeping screen.
export function setActiveJob(jobId: string) { saveJSON("aes_active_job_v1", jobId); }
export function getActiveJob(): string | null {
  return loadJSON<string | null>("aes_active_job_v1", null);
}

// ─── Employees ────────────────────────────────────────────────────────────────

export function loadEmployees(): EmployeeRecord[] { return db.getEmployees(); }
export function upsertEmployee(row: EmployeeRecord) { return db.upsertEmployee(row); }
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
