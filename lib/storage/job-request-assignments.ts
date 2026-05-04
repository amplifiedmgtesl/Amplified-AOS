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
    confirmed: !!r.confirmed,
    notes: r.notes ?? undefined,
    sortOrder: r.sort_order ?? 0,
  };
}

function assignmentToRow(a: JobRequestAssignment): Record<string, unknown> {
  return {
    id: a.id || newAssignmentId(),
    job_request_day_id: a.jobRequestDayId,
    employee_key: a.employeeKey || null,
    position_id: a.positionId || null,
    specialty_id: a.specialtyId || null,
    confirmed: !!a.confirmed,
    notes: a.notes || null,
    sort_order: a.sortOrder ?? 0,
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
