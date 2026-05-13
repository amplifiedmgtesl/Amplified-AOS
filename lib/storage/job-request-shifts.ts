/**
 * Job-scoped shifts — CRUD helper.
 *
 * Each job_request has its own list of shifts (e.g., "Load In", "Show Call",
 * "Strike"). Quote and invoice lines reference shifts by FK. Replaces the
 * free-text shift_label column dropped in migration 20260512a.
 *
 * Companion: supabase/migrations/20260512a_job_request_shifts.sql
 */

import { supabase } from "@/lib/supabase/client";
import type { JobRequestShift } from "@/lib/store/types";

function newShiftId(): string {
  return `shift-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToShift(r: any): JobRequestShift {
  return {
    id: r.id,
    jobRequestId: r.job_request_id,
    label: r.label,
    sortOrder: r.sort_order ?? 0,
    isActive: r.is_active ?? true,
  };
}

/** Load shifts for a job. Returns active-only by default. */
export async function loadShifts(
  jobRequestId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<JobRequestShift[]> {
  let q = supabase
    .from("job_request_shifts")
    .select("*")
    .eq("job_request_id", jobRequestId);
  if (!opts.includeInactive) q = q.eq("is_active", true);
  q = q.order("sort_order", { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToShift);
}

/** Bulk-load shifts for many jobs at once (e.g., invoice list). */
export async function loadShiftsForJobs(jobRequestIds: string[]): Promise<Map<string, JobRequestShift[]>> {
  if (jobRequestIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("job_request_shifts")
    .select("*")
    .in("job_request_id", jobRequestIds)
    .order("sort_order");
  if (error) throw error;
  const m = new Map<string, JobRequestShift[]>();
  for (const r of data ?? []) {
    const s = rowToShift(r);
    const arr = m.get(s.jobRequestId) ?? [];
    arr.push(s);
    m.set(s.jobRequestId, arr);
  }
  return m;
}

/** Add a new shift to a job. Returns the created row. */
export async function createShift(
  jobRequestId: string,
  label: string,
): Promise<JobRequestShift> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Shift label is required");

  // Determine next sort_order
  const existing = await loadShifts(jobRequestId, { includeInactive: true });
  const nextSort = existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.sortOrder)) + 1;

  const id = newShiftId();
  const { data, error } = await supabase
    .from("job_request_shifts")
    .insert({
      id,
      job_request_id: jobRequestId,
      label: trimmed,
      sort_order: nextSort,
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToShift(data);
}

/** Rename or reorder a shift. */
export async function updateShift(
  shiftId: string,
  patch: { label?: string; sortOrder?: number; isActive?: boolean },
): Promise<void> {
  const row: any = {};
  if (patch.label     !== undefined) row.label      = patch.label.trim();
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  if (patch.isActive  !== undefined) row.is_active  = patch.isActive;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from("job_request_shifts")
    .update(row)
    .eq("id", shiftId);
  if (error) throw error;
}

/** Hard delete a shift. Blocked by FK if any quote_line or invoice_line
 *  references it (ON DELETE RESTRICT). Use deactivateShift instead if the
 *  shift has historical references — that hides it from new pickers while
 *  preserving frozen-document display. */
export async function deleteShift(shiftId: string): Promise<void> {
  const { error } = await supabase
    .from("job_request_shifts")
    .delete()
    .eq("id", shiftId);
  if (error) throw error;
}

/** Mark a shift inactive so it stops appearing in new-line pickers but
 *  historical line references still display correctly. */
export async function deactivateShift(shiftId: string): Promise<void> {
  await updateShift(shiftId, { isActive: false });
}
