/**
 * lib/store/payroll.ts
 *
 * Phase 1 Payroll module store. Operates against the payroll_runs +
 * payroll_run_entries tables added in migration 20260528a.
 *
 * Pay-rate sourcing is intentionally untouched here — entries carry the
 * std/ot/dt rates already on the timesheet_entries row. When the standalone
 * Payroll project lands (see memory: project_payroll), the candidate query
 * and snapshot will swap to the new pay-rate source without changing the
 * run/entry shape.
 */

import { supabase } from "@/lib/supabase/client";
import type { PayrollRun, PayrollRunEntry, PayrollRunStatus } from "./types";

function newRunId(): string {
  return `prr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function newRunEntryId(): string {
  return `pre-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToRun(r: any): PayrollRun {
  return {
    id: r.id,
    payDate: r.pay_date,
    periodStart: r.period_start ?? undefined,
    periodEnd: r.period_end ?? undefined,
    status: r.status as PayrollRunStatus,
    notes: r.notes ?? undefined,
    entryCount: Number(r.entry_count ?? 0),
    employeeCount: Number(r.employee_count ?? 0),
    totalHours: Number(r.total_hours ?? 0),
    totalPay: Number(r.total_pay ?? 0),
    finalizedAt: r.finalized_at ?? undefined,
    finalizedBy: r.finalized_by ?? undefined,
    exportedAt: r.exported_at ?? undefined,
    exportedBy: r.exported_by ?? undefined,
    voidedAt: r.voided_at ?? undefined,
    voidedBy: r.voided_by ?? undefined,
    voidReason: r.void_reason ?? undefined,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    updatedBy: r.updated_by ?? undefined,
  };
}

function rowToRunEntry(r: any): PayrollRunEntry {
  return {
    id: r.id,
    payrollRunId: r.payroll_run_id,
    timesheetEntryId: r.timesheet_entry_id,
    employeeKey: r.employee_key ?? undefined,
    firstName: r.first_name ?? undefined,
    lastName: r.last_name ?? undefined,
    email: r.email ?? undefined,
    workDate: r.work_date ?? undefined,
    position: r.position ?? undefined,
    jobId: r.job_id ?? undefined,
    stdHours: Number(r.std_hours ?? 0),
    otHours: Number(r.ot_hours ?? 0),
    dtHours: Number(r.dt_hours ?? 0),
    totalHours: Number(r.total_hours ?? 0),
    stdRate: Number(r.std_rate ?? 0),
    otRate: Number(r.ot_rate ?? 0),
    dtRate: Number(r.dt_rate ?? 0),
    isHoliday: !!r.is_holiday,
    holidayMultiplier: r.holiday_multiplier == null ? undefined : Number(r.holiday_multiplier),
    totalPay: Number(r.total_pay ?? 0),
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    updatedBy: r.updated_by ?? undefined,
  };
}

// ─── Candidate query ────────────────────────────────────────────────────────
export type PayrollCandidateFilters = {
  dateFrom?: string;           // YYYY-MM-DD (entry work_date >=)
  dateTo?: string;             // YYYY-MM-DD (entry work_date <=)
  jobIds?: string[];           // restrict to these job_requests
  employeeKeys?: string[];     // restrict to these employees
  /** When undefined, all employees of any type are returned. */
  employmentType?: "staff" | "contractor";
};

/** A row in the candidate-picker grid. Mirrors the shape we need to render
 *  the preview and to snapshot into payroll_run_entries on create. */
export type PayrollCandidateRow = {
  timesheetEntryId: string;
  employeeKey: string | null;
  firstName: string;
  lastName: string;
  email: string;
  employmentType: string | null;
  workDate: string | null;
  position: string;
  jobId: string | null;
  jobClient: string;
  jobEventName: string;
  jobNo: string | null;
  stdHours: number;
  otHours: number;
  dtHours: number;
  totalHours: number;
  stdRate: number;
  otRate: number;
  dtRate: number;
  isHoliday: boolean;
  holidayMultiplier: number | null;
  totalPay: number;
};

/** Approved, unpaid timesheet entries that are eligible for a new payroll run.
 *  "Unpaid" means not currently a member of a non-voided payroll_run_entries
 *  row (the partial-unique constraint enforces single-membership). */
export async function getPayrollCandidates(filters: PayrollCandidateFilters): Promise<PayrollCandidateRow[]> {
  // Pull approved entries, excluding any already in a payroll run.
  let q = supabase
    .from("timesheet_entries")
    .select(`
      id, work_date, position, first_name, last_name, email, employee_key,
      job_id, job_sheet_id,
      std_hours, ot_hours, dt_hours, total_hours,
      std_rate, ot_rate, dt_rate,
      is_holiday, holiday_multiplier, total_pay, status
    `)
    .eq("status", "approved");

  if (filters.dateFrom) q = q.gte("work_date", filters.dateFrom);
  if (filters.dateTo)   q = q.lte("work_date", filters.dateTo);
  if (filters.jobIds && filters.jobIds.length > 0)             q = q.in("job_id", filters.jobIds);
  if (filters.employeeKeys && filters.employeeKeys.length > 0) q = q.in("employee_key", filters.employeeKeys);

  const { data: entries, error } = await q.order("work_date", { ascending: true });
  if (error) { console.error("[payroll] getPayrollCandidates entries:", error); return []; }

  // Filter out entries that are already in any payroll run.
  const entryIds = (entries ?? []).map((r: any) => r.id);
  const lockedIds = new Set<string>();
  if (entryIds.length > 0) {
    const { data: locked, error: lockedErr } = await supabase
      .from("payroll_run_entries")
      .select("timesheet_entry_id")
      .in("timesheet_entry_id", entryIds);
    if (lockedErr) { console.error("[payroll] getPayrollCandidates locked lookup:", lockedErr); }
    for (const r of locked ?? []) lockedIds.add((r as any).timesheet_entry_id);
  }
  const available = (entries ?? []).filter((r: any) => !lockedIds.has(r.id));

  // Look up employment_type per employee.
  const employeeKeys = Array.from(new Set(available.map((r: any) => r.employee_key).filter(Boolean)));
  const employmentByKey = new Map<string, string>();
  if (employeeKeys.length > 0) {
    const { data: emps, error: empsErr } = await supabase
      .from("employees")
      .select("employee_key, type, employment_type")
      .in("employee_key", employeeKeys);
    if (empsErr) { console.error("[payroll] getPayrollCandidates employees:", empsErr); }
    for (const e of emps ?? []) {
      const r = e as any;
      employmentByKey.set(r.employee_key, r.type ?? r.employment_type ?? "");
    }
  }

  // Look up job header info (job_no, client, event_name).
  const jobIds = Array.from(new Set(available.map((r: any) => r.job_id).filter(Boolean)));
  const jobByid = new Map<string, { jobNo: string | null; client: string; eventName: string }>();
  if (jobIds.length > 0) {
    const { data: jobs, error: jobsErr } = await supabase
      .from("job_requests")
      .select("id, job_no, client, event_name")
      .in("id", jobIds);
    if (jobsErr) { console.error("[payroll] getPayrollCandidates jobs:", jobsErr); }
    for (const j of jobs ?? []) {
      const r = j as any;
      jobByid.set(r.id, { jobNo: r.job_no ?? null, client: r.client ?? "", eventName: r.event_name ?? "" });
    }
  }

  let rows: PayrollCandidateRow[] = available.map((r: any) => {
    const job = r.job_id ? jobByid.get(r.job_id) : null;
    return {
      timesheetEntryId: r.id,
      employeeKey: r.employee_key ?? null,
      firstName: r.first_name ?? "",
      lastName: r.last_name ?? "",
      email: r.email ?? "",
      employmentType: r.employee_key ? (employmentByKey.get(r.employee_key) ?? null) : null,
      workDate: r.work_date ?? null,
      position: r.position ?? "",
      jobId: r.job_id ?? null,
      jobClient: job?.client ?? "",
      jobEventName: job?.eventName ?? "",
      jobNo: job?.jobNo ?? null,
      stdHours: Number(r.std_hours ?? 0),
      otHours: Number(r.ot_hours ?? 0),
      dtHours: Number(r.dt_hours ?? 0),
      totalHours: Number(r.total_hours ?? 0),
      stdRate: Number(r.std_rate ?? 0),
      otRate: Number(r.ot_rate ?? 0),
      dtRate: Number(r.dt_rate ?? 0),
      isHoliday: !!r.is_holiday,
      holidayMultiplier: r.holiday_multiplier == null ? null : Number(r.holiday_multiplier),
      totalPay: Number(r.total_pay ?? 0),
    };
  });

  if (filters.employmentType) {
    rows = rows.filter((r) => r.employmentType === filters.employmentType);
  }
  return rows;
}

// ─── Run CRUD ───────────────────────────────────────────────────────────────
export async function listPayrollRuns(): Promise<PayrollRun[]> {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("*")
    .order("pay_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) { console.error("[payroll] listPayrollRuns:", error); return []; }
  return (data ?? []).map(rowToRun);
}

export async function getPayrollRun(id: string): Promise<PayrollRun | null> {
  const { data, error } = await supabase.from("payroll_runs").select("*").eq("id", id).maybeSingle();
  if (error) { console.error("[payroll] getPayrollRun:", error); return null; }
  return data ? rowToRun(data) : null;
}

export async function getPayrollRunEntries(runId: string): Promise<PayrollRunEntry[]> {
  const { data, error } = await supabase
    .from("payroll_run_entries")
    .select("*")
    .eq("payroll_run_id", runId)
    .order("last_name", { ascending: true })
    .order("work_date", { ascending: true });
  if (error) { console.error("[payroll] getPayrollRunEntries:", error); return []; }
  return (data ?? []).map(rowToRunEntry);
}

export type CreatePayrollRunInput = {
  payDate: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string;
  entries: PayrollCandidateRow[];
};

/** Create a draft run from a set of candidate rows. Snapshots every field
 *  into payroll_run_entries so the run is durable against later edits.
 *  Returns the new run id. */
export async function createPayrollRun(input: CreatePayrollRunInput): Promise<string> {
  if (input.entries.length === 0) {
    throw new Error("Cannot create a payroll run with zero entries.");
  }
  const id = newRunId();

  const { error: insErr } = await supabase
    .from("payroll_runs")
    .insert({
      id,
      pay_date: input.payDate,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      notes: input.notes ?? null,
      status: "draft",
    });
  if (insErr) throw insErr;

  const rows = input.entries.map((e) => ({
    id: newRunEntryId(),
    payroll_run_id: id,
    timesheet_entry_id: e.timesheetEntryId,
    employee_key: e.employeeKey,
    first_name: e.firstName,
    last_name: e.lastName,
    email: e.email,
    work_date: e.workDate,
    position: e.position,
    job_id: e.jobId,
    std_hours: e.stdHours,
    ot_hours: e.otHours,
    dt_hours: e.dtHours,
    total_hours: e.totalHours,
    std_rate: e.stdRate,
    ot_rate: e.otRate,
    dt_rate: e.dtRate,
    is_holiday: e.isHoliday,
    holiday_multiplier: e.holidayMultiplier,
    total_pay: e.totalPay,
  }));

  const { error: rowsErr } = await supabase.from("payroll_run_entries").insert(rows);
  if (rowsErr) {
    // Clean up the header on failure — partial-insert state would be confusing.
    await supabase.from("payroll_runs").delete().eq("id", id);
    throw rowsErr;
  }

  return id;
}

/** Update meta on a draft run. Locked runs reject all edits except status
 *  transitions (handled by finalizeRun / voidRun). */
export async function updatePayrollRunMeta(
  id: string,
  patch: Partial<Pick<PayrollRun, "payDate" | "periodStart" | "periodEnd" | "notes">>,
): Promise<void> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.payDate     !== undefined) dbPatch.pay_date     = patch.payDate;
  if (patch.periodStart !== undefined) dbPatch.period_start = patch.periodStart || null;
  if (patch.periodEnd   !== undefined) dbPatch.period_end   = patch.periodEnd   || null;
  if (patch.notes       !== undefined) dbPatch.notes        = patch.notes       || null;
  const { error } = await supabase.from("payroll_runs").update(dbPatch).eq("id", id);
  if (error) throw error;
}

/** Remove an entry from a draft run. The DB freeze trigger blocks this if
 *  the run is finalized/exported. */
export async function removeEntryFromRun(runEntryId: string): Promise<void> {
  const { error } = await supabase.from("payroll_run_entries").delete().eq("id", runEntryId);
  if (error) throw error;
}

export async function finalizePayrollRun(id: string): Promise<void> {
  const { error } = await supabase
    .from("payroll_runs")
    .update({ status: "finalized", finalized_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw error;
}

export async function reopenPayrollRun(id: string): Promise<void> {
  // Move a finalized run back to draft. Allowed pre-export. The unique index
  // on payroll_run_entries.timesheet_entry_id remains satisfied since the
  // rows stay in place.
  const { error } = await supabase
    .from("payroll_runs")
    .update({ status: "draft", finalized_at: null, finalized_by: null })
    .eq("id", id)
    .eq("status", "finalized");
  if (error) throw error;
}

export async function voidPayrollRun(id: string, reason?: string): Promise<void> {
  // The DB trigger payroll_runs_void_releases_entries clears the junction
  // rows so the underlying timesheet entries become candidates again.
  const { error } = await supabase
    .from("payroll_runs")
    .update({
      status: "voided",
      void_reason: reason ?? null,
      voided_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}
