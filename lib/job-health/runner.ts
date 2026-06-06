"use client";

// Build the HealthContext once for a given job_request, then run every
// registered check synchronously over it. Single batched I/O hop.

import { supabase } from "@/lib/supabase/client";
import { loadJobRequestDays, loadCrewNeedsForRequest } from "@/lib/storage/job-request-days";
import { loadAssignmentsForRequest } from "@/lib/storage/job-request-assignments";
import { loadShifts } from "@/lib/storage/job-request-shifts";
import { loadQuotes, resolveRateCardForJob } from "@/lib/store/quotes";
import { loadInvoices } from "@/lib/store/invoices";
import { getRateCardProfiles, getSpecialties } from "@/lib/store/db";
import type { JobRequest, TimeEntry } from "@/lib/store/types";
import type { Finding, HealthContext } from "./types";
import { CHECKS } from "./registry";

async function loadTimesheetEntriesForJob(jobId: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("timesheet_entries")
    .select("*")
    .eq("job_id", jobId);
  if (error) {
    console.error("[job-health] loadTimesheetEntriesForJob:", error);
    return [];
  }
  // Minimal row→TimeEntry mapping — checks only read a handful of fields.
  return (data ?? []).map((r: any) => ({
    id: r.id,
    position: r.position ?? "",
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    workDate: r.work_date ?? undefined,
    endDate: r.end_date ?? undefined,
    timeIn1: r.time_in1 ?? "",
    timeOut1: r.time_out1 ?? "",
    timeIn2: r.time_in2 ?? "",
    timeOut2: r.time_out2 ?? "",
    lunchMinutes: r.lunch_minutes ?? 0,
    mealBreak1Minutes: r.meal_break_1_minutes ?? 0,
    mealBreak2Minutes: r.meal_break_2_minutes ?? 0,
    stdHours: Number(r.std_hours ?? 0),
    otHours: Number(r.ot_hours ?? 0),
    dtHours: Number(r.dt_hours ?? 0),
    totalHours: Number(r.total_hours ?? 0),
    billStdRate: Number(r.bill_std_rate ?? 0),
    billOtRate: Number(r.bill_ot_rate ?? 0),
    billDtRate: Number(r.bill_dt_rate ?? 0),
    billOtAfter: r.bill_ot_after,
    billDtAfter: r.bill_dt_after,
    billTotal: Number(r.bill_total ?? 0),
    employeeKey: r.employee_key ?? null,
    userId: r.user_id ?? null,
    status: r.status ?? null,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
    jobId: r.job_id ?? null,
    invoiceLineId: r.invoice_line_id ?? null,
    shiftId: r.shift_id ?? null,
    positionId: r.position_id ?? null,
    specialtyId: r.specialty_id ?? null,
    isHoliday: r.is_holiday ?? false,
    holidayMultiplier: r.holiday_multiplier,
  } as TimeEntry));
}

export async function buildHealthContext(jobRequest: JobRequest): Promise<HealthContext> {
  const jobId = jobRequest.id;
  const [
    days,
    crewNeeds,
    assignments,
    shifts,
    rateCardLite,
    quotes,
    invoices,
    timesheetEntries,
  ] = await Promise.all([
    loadJobRequestDays(jobId),
    loadCrewNeedsForRequest(jobId),
    loadAssignmentsForRequest(jobId),
    loadShifts(jobId),
    resolveRateCardForJob(jobId).catch(() => null),
    loadQuotes({ jobRequestId: jobId, hideSuperseded: true }),
    loadInvoices({ jobRequestId: jobId, hideSupersededAndVoid: true }),
    loadTimesheetEntriesForJob(jobId),
  ]);

  // The lightweight rate card returned by resolveRateCardForJob doesn't carry
  // the typed RateRow array — look the full profile up from the in-memory
  // cache for that shape. Falls back to null if cache miss.
  const profiles = getRateCardProfiles();
  const rateCard = rateCardLite ? profiles.find((p) => p.id === rateCardLite.id) ?? null : null;
  const rateCardSource: HealthContext["rateCardSource"] = jobRequest.rateCardProfileId
    ? "job_override"
    : rateCard
    ? "effective_lookup"
    : "none";

  return {
    jobRequest,
    days,
    crewNeeds,
    assignments,
    shifts,
    rateCard,
    rateCardSource,
    quotes,
    invoices,
    timesheetEntries,
    specialties: getSpecialties(),
  };
}

export async function runHealthChecks(jobRequest: JobRequest): Promise<{
  ctx: HealthContext;
  findings: Finding[];
}> {
  const ctx = await buildHealthContext(jobRequest);
  const findings: Finding[] = [];
  for (const check of CHECKS) {
    try {
      findings.push(...check(ctx));
    } catch (e) {
      console.error("[job-health] check threw:", e);
    }
  }
  return { ctx, findings };
}
