// Per-day breakdown of a job request, plus the crew the client wants for
// each day. Mirrors the pattern in job-request-attachments.ts: direct supabase
// calls, no in-memory cache. The DB has a trigger that keeps the legacy
// job_requests flat columns in sync from these rows.

import { supabase } from "@/lib/supabase/client";
import type { JobRequestDay, JobRequestCrewNeed } from "@/lib/store/types";

function newDayId(jobRequestId: string, eventDate: string): string {
  return `${jobRequestId}_d${eventDate.replace(/-/g, "")}`;
}

function newCrewNeedId(): string {
  return `jrcn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToDay(r: any): JobRequestDay {
  return {
    id: r.id,
    jobRequestId: r.job_request_id,
    eventDate: r.event_date,
    callTime: r.call_time ?? undefined,
    startTime: r.start_time ?? undefined,
    endTime: r.end_time ?? undefined,
    expectedHours: r.expected_hours ?? undefined,
    notes: r.notes ?? undefined,
    sortOrder: r.sort_order ?? 0,
    isHoliday: !!r.is_holiday,
  };
}

function rowToCrewNeed(r: any): JobRequestCrewNeed {
  return {
    id: r.id,
    jobRequestDayId: r.job_request_day_id,
    positionId: r.position_id ?? undefined,
    specialtyId: r.specialty_id ?? undefined,
    shiftId: r.shift_id ?? undefined,
    quantity: r.quantity ?? 1,
    hours: r.hours ?? undefined,
    notes: r.notes ?? undefined,
    sortOrder: r.sort_order ?? 0,
  };
}

function dayToRow(d: JobRequestDay): Record<string, unknown> {
  return {
    id: d.id || newDayId(d.jobRequestId, d.eventDate),
    job_request_id: d.jobRequestId,
    event_date: d.eventDate,
    call_time: d.callTime || null,
    start_time: d.startTime || null,
    end_time: d.endTime || null,
    expected_hours: d.expectedHours ?? null,
    notes: d.notes || null,
    sort_order: d.sortOrder ?? 0,
    is_holiday: !!d.isHoliday,
  };
}

function crewNeedToRow(c: JobRequestCrewNeed): Record<string, unknown> {
  return {
    id: c.id || newCrewNeedId(),
    job_request_day_id: c.jobRequestDayId,
    position_id: c.positionId || null,
    specialty_id: c.specialtyId || null,
    shift_id: c.shiftId || null,
    quantity: c.quantity ?? 1,
    hours: c.hours ?? null,
    notes: c.notes || null,
    sort_order: c.sortOrder ?? 0,
  };
}

// ─── Days ────────────────────────────────────────────────────────────────────

export async function loadJobRequestDays(jobRequestId: string): Promise<JobRequestDay[]> {
  const { data, error } = await supabase
    .from("job_request_days")
    .select("*")
    .eq("job_request_id", jobRequestId)
    .order("event_date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToDay);
}

export async function upsertJobRequestDay(d: JobRequestDay): Promise<JobRequestDay> {
  const row = dayToRow(d);
  const { data, error } = await supabase
    .from("job_request_days")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return rowToDay(data);
}

export async function deleteJobRequestDay(id: string): Promise<void> {
  const { error } = await supabase.from("job_request_days").delete().eq("id", id);
  if (error) throw error;
}

// ─── Crew needs ──────────────────────────────────────────────────────────────

export async function loadCrewNeedsForDay(jobRequestDayId: string): Promise<JobRequestCrewNeed[]> {
  const { data, error } = await supabase
    .from("job_request_crew_needs")
    .select("*")
    .eq("job_request_day_id", jobRequestDayId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToCrewNeed);
}

export async function loadCrewNeedsForRequest(jobRequestId: string): Promise<JobRequestCrewNeed[]> {
  // Two-step: pull day IDs, then their crew needs in one round-trip.
  const days = await loadJobRequestDays(jobRequestId);
  if (days.length === 0) return [];
  const dayIds = days.map((d) => d.id);
  const { data, error } = await supabase
    .from("job_request_crew_needs")
    .select("*")
    .in("job_request_day_id", dayIds)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToCrewNeed);
}

export async function upsertJobRequestCrewNeed(c: JobRequestCrewNeed): Promise<JobRequestCrewNeed> {
  const row = crewNeedToRow(c);
  const { data, error } = await supabase
    .from("job_request_crew_needs")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return rowToCrewNeed(data);
}

export async function deleteJobRequestCrewNeed(id: string): Promise<void> {
  const { error } = await supabase.from("job_request_crew_needs").delete().eq("id", id);
  if (error) throw error;
}

// ─── Convenience: full save ──────────────────────────────────────────────────
// Replace the days + crew needs for a request in one call. Deletes any rows
// not present in the input.
export async function replaceRequestDaysAndCrew(
  jobRequestId: string,
  days: JobRequestDay[],
  crewByDayId: Record<string, JobRequestCrewNeed[]>,
): Promise<void> {
  const existing = await loadJobRequestDays(jobRequestId);
  const incomingIds = new Set(days.map((d) => d.id || newDayId(d.jobRequestId, d.eventDate)));

  // Delete days no longer present (cascades to crew needs).
  for (const d of existing) {
    if (!incomingIds.has(d.id)) await deleteJobRequestDay(d.id);
  }

  // Upsert each day, then its crew needs.
  for (const d of days) {
    const persisted = await upsertJobRequestDay({
      ...d,
      id: d.id || newDayId(d.jobRequestId, d.eventDate),
    });
    const crew = crewByDayId[d.id] ?? crewByDayId[persisted.id] ?? [];
    const existingCrew = await loadCrewNeedsForDay(persisted.id);
    const incomingCrewIds = new Set(crew.map((c) => c.id).filter(Boolean));
    for (const c of existingCrew) {
      if (!incomingCrewIds.has(c.id)) await deleteJobRequestCrewNeed(c.id);
    }
    for (const c of crew) {
      await upsertJobRequestCrewNeed({ ...c, jobRequestDayId: persisted.id });
    }
  }
}
