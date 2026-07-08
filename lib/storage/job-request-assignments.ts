// Per-day crew assignments on a job request. The actual people scheduled
// to work each day. See migration 20260503c_job_request_assignments.sql
// and types.ts for the data shape.

import { supabase } from "@/lib/supabase/client";
import type { JobRequestAssignment } from "@/lib/store/types";

function newAssignmentId(): string {
  return `jra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToAssignment(r: any): JobRequestAssignment {
  return {
    id: r.id,
    jobRequestDayId: r.job_request_day_id,
    employeeKey: r.employee_key ?? undefined,
    positionId: r.position_id ?? undefined,
    specialtyId: r.specialty_id ?? undefined,
    shiftId: r.shift_id ?? undefined,
    confirmed: !!r.confirmed,
    notes: r.notes ?? undefined,
    sortOrder: r.sort_order ?? 0,
    plannedIn1: r.planned_in1 ?? undefined,
    plannedOut1: r.planned_out1 ?? undefined,
    plannedIn2: r.planned_in2 ?? undefined,
    plannedOut2: r.planned_out2 ?? undefined,
  };
}

function assignmentToRow(a: JobRequestAssignment): Record<string, unknown> {
  return {
    id: a.id || newAssignmentId(),
    job_request_day_id: a.jobRequestDayId,
    employee_key: a.employeeKey || null,
    position_id: a.positionId || null,
    specialty_id: a.specialtyId || null,
    shift_id: a.shiftId || null,
    confirmed: !!a.confirmed,
    notes: a.notes || null,
    sort_order: a.sortOrder ?? 0,
    planned_in1: a.plannedIn1 || null,
    planned_out1: a.plannedOut1 || null,
    planned_in2: a.plannedIn2 || null,
    planned_out2: a.plannedOut2 || null,
  };
}

export async function loadAssignmentsForDay(jobRequestDayId: string): Promise<JobRequestAssignment[]> {
  const { data, error } = await supabase
    .from("job_request_assignments")
    .select("*")
    .eq("job_request_day_id", jobRequestDayId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToAssignment);
}

export async function loadAssignmentsForRequest(jobRequestId: string): Promise<JobRequestAssignment[]> {
  // Two-step: pull day IDs, then their assignments in one round-trip.
  const { data: days, error: dayErr } = await supabase
    .from("job_request_days")
    .select("id")
    .eq("job_request_id", jobRequestId);
  if (dayErr) throw dayErr;
  const dayIds = (days ?? []).map((d: any) => d.id);
  if (dayIds.length === 0) return [];
  const { data, error } = await supabase
    .from("job_request_assignments")
    .select("*")
    .in("job_request_day_id", dayIds)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToAssignment);
}

export async function upsertAssignment(a: JobRequestAssignment): Promise<JobRequestAssignment> {
  const row = assignmentToRow(a);
  const { data, error } = await supabase
    .from("job_request_assignments")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return rowToAssignment(data);
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabase.from("job_request_assignments").delete().eq("id", id);
  if (error) throw error;
}

// Composite slot record used by timekeeping's "Add Crew from Job" flow.
// Each slot = one (employee, day, shift) tuple resolved through assignments.
// Returns the data needed to seed one TimeEntry row per slot.
export type JobCrewSlot = {
  assignmentId: string;
  jobRequestDayId: string;
  eventDate: string;               // YYYY-MM-DD
  startTime: string | null;        // HH:MM (24h) day window, or null
  endTime: string | null;
  // Per-worker planned times (assignment-level), HH:MM (24h) or null. When
  // null, callers fall back to the day window (startTime/endTime) for pair 1.
  plannedIn1: string | null;
  plannedOut1: string | null;
  plannedIn2: string | null;
  plannedOut2: string | null;
  shiftId: string | null;
  shiftLabel: string | null;
  positionId: string | null;
  specialtyId: string | null;
  employeeKey: string | null;
};

/** Load every per-day crew assignment for a job_request, joined with the
 *  day's event_date / times and the shift label. Sorted by date then shift
 *  then sort_order so the resulting TimeEntry rows come out in a useful
 *  order. */
export async function loadJobCrewSlots(jobRequestId: string): Promise<JobCrewSlot[]> {
  const { data: days, error: dayErr } = await supabase
    .from("job_request_days")
    .select("id, event_date, start_time, end_time, sort_order")
    .eq("job_request_id", jobRequestId)
    .order("event_date", { ascending: true });
  if (dayErr) throw dayErr;
  if (!days || days.length === 0) return [];

  const dayMap = new Map<string, { event_date: string; start_time: string | null; end_time: string | null }>();
  for (const d of days as any[]) {
    dayMap.set(d.id, { event_date: d.event_date, start_time: d.start_time ?? null, end_time: d.end_time ?? null });
  }

  const { data: shifts, error: shErr } = await supabase
    .from("job_request_shifts")
    .select("id, label, sort_order")
    .eq("job_request_id", jobRequestId);
  if (shErr) throw shErr;
  const shiftMap = new Map<string, string>();
  for (const s of (shifts ?? []) as any[]) shiftMap.set(s.id, s.label ?? "");

  const dayIds = (days as any[]).map((d) => d.id);
  const { data: aRows, error: aErr } = await supabase
    .from("job_request_assignments")
    .select("id, job_request_day_id, shift_id, position_id, specialty_id, employee_key, sort_order, planned_in1, planned_out1, planned_in2, planned_out2")
    .in("job_request_day_id", dayIds)
    .order("sort_order", { ascending: true });
  if (aErr) throw aErr;

  return (aRows ?? []).map((r: any) => {
    const day = dayMap.get(r.job_request_day_id);
    return {
      assignmentId: r.id,
      jobRequestDayId: r.job_request_day_id,
      eventDate: day?.event_date ?? "",
      startTime: day?.start_time ?? null,
      endTime: day?.end_time ?? null,
      plannedIn1: r.planned_in1 ?? null,
      plannedOut1: r.planned_out1 ?? null,
      plannedIn2: r.planned_in2 ?? null,
      plannedOut2: r.planned_out2 ?? null,
      shiftId: r.shift_id ?? null,
      shiftLabel: r.shift_id ? (shiftMap.get(r.shift_id) ?? null) : null,
      positionId: r.position_id ?? null,
      specialtyId: r.specialty_id ?? null,
      employeeKey: r.employee_key ?? null,
    };
  }).sort((a, b) =>
    a.eventDate.localeCompare(b.eventDate)
    || (a.shiftLabel ?? "").localeCompare(b.shiftLabel ?? "")
  );
}
