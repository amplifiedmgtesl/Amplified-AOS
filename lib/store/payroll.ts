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
import { resolveRateCardForJob, pickRateCardForJob } from "./quotes";

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
    payWeekStart: (r.pay_week_start ?? "sun") as "sun" | "mon",
    entryCount: Number(r.entry_count ?? 0),
    employeeCount: Number(r.employee_count ?? 0),
    totalHours: Number(r.total_hours ?? 0),
    totalPay: Number(r.total_pay ?? 0),
    otCalculatedAt: r.ot_calculated_at ?? undefined,
    otCalculatedBy: r.ot_calculated_by ?? undefined,
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
    specialtyId: r.specialty_id ?? undefined,
    specialty: r.specialty ?? undefined,
    jobId: r.job_id ?? undefined,
    stdHours: Number(r.std_hours ?? 0),
    otHours: Number(r.ot_hours ?? 0),
    dtHours: Number(r.dt_hours ?? 0),
    totalHours: Number(r.total_hours ?? 0),
    payStdHours: Number(r.pay_std_hours ?? 0),
    payOtHours: Number(r.pay_ot_hours ?? 0),
    payDtHours: Number(r.pay_dt_hours ?? 0),
    payTotalHours: Number(r.pay_total_hours ?? 0),
    payAdjustmentReason: r.pay_adjustment_reason ?? undefined,
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
  /** Canonical specialty FK on the timesheet entry. Needed by
   *  resolvePayRateForEntry to look up the right rate-card row. */
  specialtyId: string | null;
  /** Specialty display name (denormalized). Surfaces in the candidate
   *  picker and gets snapshotted onto payroll_run_entries.specialty. */
  specialty: string | null;
  jobId: string | null;
  jobClient: string;
  jobEventName: string;
  jobNo: string | null;
  stdHours: number;
  otHours: number;
  dtHours: number;
  totalHours: number;
  // NOTE: no rate fields here intentionally. timesheet_entries carries BILL
  // rates only (renamed bill_std_rate / bill_ot_rate / bill_dt_rate / bill_total
  // in migration 20260528b). Payroll must not snapshot bill numbers as if
  // they were pay — that bug is what motivated the rename. Base pay rate
  // defaults to 0 on snapshot; the operator fills it in per row on the run
  // detail page. When the standalone payroll project lands and provides a
  // real pay-rate source, candidate enrichment swaps in here.
  isHoliday: boolean;
  holidayMultiplier: number | null;
};

/** Approved, unpaid timesheet entries that are eligible for a new payroll run.
 *  "Unpaid" means not currently a member of a non-voided payroll_run_entries
 *  row (the partial-unique constraint enforces single-membership). */
export async function getPayrollCandidates(filters: PayrollCandidateFilters): Promise<PayrollCandidateRow[]> {
  // Pull approved entries, excluding any already in a payroll run.
  // Intentionally NOT selecting bill_std_rate / bill_ot_rate / bill_dt_rate /
  // bill_total — those are billing fields and have no business being copied
  // into payroll snapshots.
  let q = supabase
    .from("timesheet_entries")
    .select(`
      id, work_date, position, specialty_id, first_name, last_name, email, employee_key,
      job_id, job_sheet_id,
      std_hours, ot_hours, dt_hours, total_hours,
      is_holiday, holiday_multiplier, status
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

  // Look up specialty names for any candidate row that has specialty_id.
  const specialtyIds = Array.from(new Set(available.map((r: any) => r.specialty_id).filter(Boolean)));
  const specialtyNameById = new Map<string, string>();
  if (specialtyIds.length > 0) {
    const { data: specs, error: specsErr } = await supabase
      .from("specialties")
      .select("id, name")
      .in("id", specialtyIds);
    if (specsErr) { console.error("[payroll] getPayrollCandidates specialties:", specsErr); }
    for (const s of specs ?? []) specialtyNameById.set((s as any).id, (s as any).name);
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
      specialtyId: r.specialty_id ?? null,
      specialty: r.specialty_id ? (specialtyNameById.get(r.specialty_id) ?? null) : null,
      jobId: r.job_id ?? null,
      jobClient: job?.client ?? "",
      jobEventName: job?.eventName ?? "",
      jobNo: job?.jobNo ?? null,
      stdHours: Number(r.std_hours ?? 0),
      otHours: Number(r.ot_hours ?? 0),
      dtHours: Number(r.dt_hours ?? 0),
      totalHours: Number(r.total_hours ?? 0),
      isHoliday: !!r.is_holiday,
      holidayMultiplier: r.holiday_multiplier == null ? null : Number(r.holiday_multiplier),
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

/** Time/meal fields fetched live from timesheet_entries for the print view.
 *  Keyed by timesheet_entry_id. Used to enrich the print output without
 *  bloating the payroll_run_entries snapshot (timesheet_entries are frozen
 *  once approved, so these values are stable for the life of an active run).
 */
export type PayrollRunPrintExtras = {
  timeIn1: string;
  timeOut1: string;
  timeIn2: string;
  timeOut2: string;
  mealBreak1Minutes: number;
  mealBreak2Minutes: number;
};

export async function getPayrollRunPrintExtras(runId: string): Promise<Map<string, PayrollRunPrintExtras>> {
  const { data: refs, error: refsErr } = await supabase
    .from("payroll_run_entries")
    .select("timesheet_entry_id")
    .eq("payroll_run_id", runId);
  if (refsErr) { console.error("[payroll] print extras refs:", refsErr); return new Map(); }
  const ids = (refs ?? []).map((r: any) => r.timesheet_entry_id);
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("timesheet_entries")
    .select("id, time_in1, time_out1, time_in2, time_out2, meal_break_1_minutes, meal_break_2_minutes")
    .in("id", ids);
  if (error) { console.error("[payroll] print extras:", error); return new Map(); }
  const m = new Map<string, PayrollRunPrintExtras>();
  for (const r of data ?? []) {
    const row = r as any;
    m.set(row.id, {
      timeIn1: row.time_in1 ?? "",
      timeOut1: row.time_out1 ?? "",
      timeIn2: row.time_in2 ?? "",
      timeOut2: row.time_out2 ?? "",
      mealBreak1Minutes: Number(row.meal_break_1_minutes ?? 0),
      mealBreak2Minutes: Number(row.meal_break_2_minutes ?? 0),
    });
  }
  return m;
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

  // Snapshot rows. Pay rates auto-fill from resolvePayRateForEntry
  // (employee override → job's rate card → master default). If no layer
  // has a value, std_rate stays 0 and the run detail page surfaces the
  // yellow "needs rates" banner + blocks Finalize. Operator can override
  // any row via the BaseRateInput.
  //
  // Hour buckets: std/ot/dt mirror the BILLED snapshot from the timesheet.
  // pay_* buckets apply Connor's row-local payroll rules at this point
  // (5hr daily minimum + round up to whole hour). The weekly 40hr spill
  // is NOT applied here — it runs at finalize time so we can see hours
  // from other finalized runs in the same week.
  //
  // Resolve pay rates FIRST so applyDailyRulesToCandidates can route
  // daily bumps to the highest-rate row in each (employee, date) group
  // (Connor's rule, 2026-05-31).
  const resolutions = await Promise.all(input.entries.map((e) => resolvePayRateForEntry({
    employeeKey: e.employeeKey,
    specialtyId: e.specialtyId,
    jobId: e.jobId,
    workDate: e.workDate,
  })));
  const ratesByRowId = new Map<string, number>();
  for (let i = 0; i < input.entries.length; i++) {
    ratesByRowId.set(input.entries[i].timesheetEntryId, resolutions[i].stdRate);
  }
  const dailyAdjustments = applyDailyRulesToCandidates(input.entries.map(e => ({
    timesheetEntryId: e.timesheetEntryId,
    employeeKey: e.employeeKey,
    workDate: e.workDate,
    stdHours: e.stdHours,
    otHours: e.otHours,
    dtHours: e.dtHours,
  })), ratesByRowId);
  const rows = input.entries.map((e, i) => {
    const resolved = resolutions[i];
    const pay = dailyAdjustments.get(e.timesheetEntryId) ?? {
      payStdHours: e.stdHours, payOtHours: e.otHours, payDtHours: e.dtHours,
      payTotalHours: e.totalHours, payAdjustmentReason: null,
    };
    const calc = recomputePayFromBase({
      baseRate: resolved.stdRate,
      payStdHours: pay.payStdHours,
      payOtHours:  pay.payOtHours,
      payDtHours:  pay.payDtHours,
      payTotalHours: pay.payTotalHours,
      isHoliday: e.isHoliday,
      holidayMultiplier: e.holidayMultiplier,
    });
    return {
      id: newRunEntryId(),
      payroll_run_id: id,
      timesheet_entry_id: e.timesheetEntryId,
      employee_key: e.employeeKey,
      first_name: e.firstName,
      last_name: e.lastName,
      email: e.email,
      work_date: e.workDate,
      position: e.position,
      specialty_id: e.specialtyId,
      specialty: e.specialty,
      job_id: e.jobId,
      std_hours: e.stdHours,
      ot_hours: e.otHours,
      dt_hours: e.dtHours,
      total_hours: e.totalHours,
      pay_std_hours: pay.payStdHours,
      pay_ot_hours:  pay.payOtHours,
      pay_dt_hours:  pay.payDtHours,
      pay_total_hours: pay.payTotalHours,
      pay_adjustment_reason: pay.payAdjustmentReason,
      std_rate: calc.stdRate,
      ot_rate:  calc.otRate,
      dt_rate:  calc.dtRate,
      is_holiday: e.isHoliday,
      holiday_multiplier: e.holidayMultiplier,
      total_pay: calc.totalPay,
    };
  });

  const { error: rowsErr } = await supabase.from("payroll_run_entries").insert(rows);
  if (rowsErr) {
    // Clean up the header on failure — partial-insert state would be confusing.
    await supabase.from("payroll_runs").delete().eq("id", id);
    throw rowsErr;
  }

  // Super-freeze: stamp payroll_run_id on each source timesheet_entry so
  // the freeze trigger blocks edits to the source. Cleared automatically
  // by the payroll_runs_void_releases_entries trigger on void, or by
  // removeEntryFromRun on per-entry removal.
  await stampTimesheetEntriesWithRun(id, input.entries.map((e) => e.timesheetEntryId));

  return id;
}

/** Add more candidate entries to an existing draft run. Snapshots each
 *  candidate into a new payroll_run_entries row exactly the way
 *  createPayrollRun does. The DB freeze trigger guards against doing
 *  this on a finalized/exported run; the partial-unique index on
 *  timesheet_entry_id guards against double-inclusion across runs.
 *
 *  Returns the count of rows actually inserted (will throw if Postgres
 *  rejects any single row — partial-insert state is then rolled back by
 *  the supabase-js batch). */
export async function addEntriesToPayrollRun(
  runId: string,
  entries: PayrollCandidateRow[],
): Promise<number> {
  if (entries.length === 0) return 0;
  // Safety: refuse to insert against a non-draft run client-side. The DB
  // freeze trigger will also reject, but a clean preflight error is nicer.
  const { data: runRow, error: runErr } = await supabase
    .from("payroll_runs").select("status").eq("id", runId).single();
  if (runErr) throw runErr;
  if ((runRow as any).status !== "draft") {
    throw new Error(`Cannot add entries — run is ${(runRow as any).status}. Reopen it first.`);
  }

  // Same auto-fill pattern as createPayrollRun: resolve pay rates FIRST,
  // then apply daily rules (5hr min + round up) with rate context so the
  // bumps route to the highest-rate row in each (employee, date) group.
  const resolutions = await Promise.all(entries.map((e) => resolvePayRateForEntry({
    employeeKey: e.employeeKey,
    specialtyId: e.specialtyId,
    jobId: e.jobId,
    workDate: e.workDate,
  })));
  const ratesByRowId = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    ratesByRowId.set(entries[i].timesheetEntryId, resolutions[i].stdRate);
  }
  const dailyAdjustments = applyDailyRulesToCandidates(entries.map(e => ({
    timesheetEntryId: e.timesheetEntryId,
    employeeKey: e.employeeKey,
    workDate: e.workDate,
    stdHours: e.stdHours,
    otHours: e.otHours,
    dtHours: e.dtHours,
  })), ratesByRowId);

  // Adding entries to an existing run can cross a daily-group boundary
  // (e.g. another shift for an employee already on the run for that day).
  // Clear ot_calculated_at since the weekly totals just changed.
  await supabase
    .from("payroll_runs")
    .update({ ot_calculated_at: null, ot_calculated_by: null })
    .eq("id", runId);

  const rows = entries.map((e, i) => {
    const resolved = resolutions[i];
    const pay = dailyAdjustments.get(e.timesheetEntryId) ?? {
      payStdHours: e.stdHours, payOtHours: e.otHours, payDtHours: e.dtHours,
      payTotalHours: e.totalHours, payAdjustmentReason: null,
    };
    const calc = recomputePayFromBase({
      baseRate: resolved.stdRate,
      payStdHours: pay.payStdHours,
      payOtHours:  pay.payOtHours,
      payDtHours:  pay.payDtHours,
      payTotalHours: pay.payTotalHours,
      isHoliday: e.isHoliday,
      holidayMultiplier: e.holidayMultiplier,
    });
    return {
    id: newRunEntryId(),
    payroll_run_id: runId,
    timesheet_entry_id: e.timesheetEntryId,
    employee_key: e.employeeKey,
    first_name: e.firstName,
    last_name: e.lastName,
    email: e.email,
    work_date: e.workDate,
    position: e.position,
    specialty_id: e.specialtyId,
    specialty: e.specialty,
    job_id: e.jobId,
    std_hours: e.stdHours,
    ot_hours: e.otHours,
    dt_hours: e.dtHours,
    total_hours: e.totalHours,
    pay_std_hours: pay.payStdHours,
    pay_ot_hours:  pay.payOtHours,
    pay_dt_hours:  pay.payDtHours,
    pay_total_hours: pay.payTotalHours,
    pay_adjustment_reason: pay.payAdjustmentReason,
    std_rate: calc.stdRate,
    ot_rate:  calc.otRate,
    dt_rate:  calc.dtRate,
    is_holiday: e.isHoliday,
    holiday_multiplier: e.holidayMultiplier,
    total_pay: calc.totalPay,
    };
  });
  const { error } = await supabase.from("payroll_run_entries").insert(rows);
  if (error) throw error;

  // Super-freeze the newly-added source entries.
  await stampTimesheetEntriesWithRun(runId, entries.map((e) => e.timesheetEntryId));

  return rows.length;
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

/** Helper: stamp `timesheet_entries.payroll_run_id = runId` on a batch
 *  of entry IDs. Called when entries are added to a run (createPayrollRun
 *  / addEntriesToPayrollRun). The freeze trigger uses this column to
 *  super-freeze the source row while the run is non-voided. Cleared by:
 *    * removeEntryFromRun — per-entry removal
 *    * payroll_runs_void_releases_entries (DB trigger) — void cascade
 */
async function stampTimesheetEntriesWithRun(runId: string, entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const { error } = await supabase
    .from("timesheet_entries")
    .update({ payroll_run_id: runId })
    .in("id", entryIds);
  if (error) {
    // Don't throw — the snapshot is already saved and totals will compute
    // correctly. The super-freeze just won't kick in until a follow-up
    // sync. Log loud so it's visible in the console.
    console.error("[payroll] stampTimesheetEntriesWithRun:", error);
  }
}

// ─── Pay-rate multipliers (Phase 1) ───────────────────────────────────────
// Connor's confirmed rule (see memory: project_payroll.md): pay multipliers
// match the bill multipliers exactly. OT = 1.5x base, DT = 2.0x base. On
// holiday rows the OT/DT premium does NOT stack — pay collapses to
// total_hours × base × holiday_multiplier (snapshotted on the entry).
//
// These constants live here for Phase 1 so the payroll module can recompute
// rates client-side when the operator edits a base rate. The future payroll
// project will source actual pay rates from a dedicated table; the
// multipliers themselves are expected to stay the same.
export const PAYROLL_OT_MULTIPLIER = 1.5;
export const PAYROLL_DT_MULTIPLIER = 2.0;

// ─── Payroll rule constants (Connor's policy) ─────────────────────────────
/** Per-day minimum. Days with fewer billed hours are bumped up to this floor
 *  in pay_std_hours. */
export const PAYROLL_DAILY_MINIMUM_HOURS = 5;
/** Anything past this in a pay week spills from pay_std to pay_ot. DT is
 *  not touched. */
export const PAYROLL_WEEKLY_OT_THRESHOLD = 40;

// ─── Pure helpers for Connor's payroll rules ──────────────────────────────
// These are pure functions intentionally — no DB, no I/O. They're called
// at snapshot time (rules 1-3) and at finalize time (rule 4) so the
// behaviour is uniform and easy to unit-test.

export type DayPayBuckets = {
  payStdHours: number;
  payOtHours: number;
  payDtHours: number;
  payTotalHours: number;
  reasons: string[];
};

/** Per-day rules (1–3): take the summed billed buckets for one employee on
 *  one work_date and produce the pay buckets with the 5-hour minimum and
 *  whole-hour round-up applied. The daily OT/DT split coming in from the
 *  timesheet is preserved verbatim (rule 3) — we only inflate pay_std to
 *  satisfy the minimum, then ceil the total. The extra hours always land
 *  in pay_std (never pay_ot or pay_dt). */
export function applyDailyPayrollRules(input: {
  stdHours: number;
  otHours: number;
  dtHours: number;
}): DayPayBuckets {
  const std = Math.max(0, input.stdHours || 0);
  const ot  = Math.max(0, input.otHours  || 0);
  const dt  = Math.max(0, input.dtHours  || 0);
  const billedTotal = std + ot + dt;

  // No-show: zero billed hours means the employee didn't work that day.
  // Neither the daily minimum nor the round-up applies. Pay = 0.
  if (billedTotal === 0) {
    return { payStdHours: 0, payOtHours: 0, payDtHours: 0, payTotalHours: 0, reasons: [] };
  }

  let payStd = std;
  let payOt  = ot;
  let payDt  = dt;
  const reasons: string[] = [];

  // Rule 1: 5-hour minimum per day. Bump pay_std up to satisfy floor.
  const afterMinTotal = Math.max(billedTotal, PAYROLL_DAILY_MINIMUM_HOURS);
  if (afterMinTotal > billedTotal) {
    payStd += (afterMinTotal - billedTotal);
    reasons.push(`5hr min applied (+${(afterMinTotal - billedTotal).toFixed(2)})`);
  }

  // Rule 2: round UP to next whole hour. Extra absorbed by pay_std.
  const beforeCeilTotal = payStd + payOt + payDt;
  const ceilTotal = Math.ceil(beforeCeilTotal - 1e-9);
  if (ceilTotal > beforeCeilTotal) {
    payStd += (ceilTotal - beforeCeilTotal);
    reasons.push(`rounded ${beforeCeilTotal.toFixed(2)}→${ceilTotal}`);
  }

  // Round to 2 decimals to keep DB numerics clean.
  const r = (n: number) => Math.round(n * 100) / 100;
  payStd = r(payStd);
  payOt  = r(payOt);
  payDt  = r(payDt);
  const payTotal = r(payStd + payOt + payDt);

  return {
    payStdHours: payStd,
    payOtHours:  payOt,
    payDtHours:  payDt,
    payTotalHours: payTotal,
    reasons,
  };
}

/** Map a YYYY-MM-DD work_date to the Sunday or Monday of its pay week
 *  (returned as YYYY-MM-DD). Pure date math — no timezone conversion. */
export function payWeekStartFor(workDate: string, weekStart: "sun" | "mon"): string {
  // Build a UTC date so we don't accidentally cross day boundaries via TZ.
  const [y, m, d] = workDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  let offset: number;
  if (weekStart === "sun") {
    offset = day;             // Sun=0 → -0, Sat=6 → -6
  } else {
    offset = (day + 6) % 7;   // Mon=1 → -0, Sun=0 → -6
  }
  dt.setUTCDate(dt.getUTCDate() - offset);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Type used by applyWeeklySpill. Lets the caller mark some rows as
 *  read-only "prior" hours (from already-finalized runs) so we count
 *  them toward the cumulative 40 but never mutate them. */
export type WeekHourRow = {
  /** Stable id of the source row (timesheet_entry_id is fine). */
  key: string;
  workDate: string;
  payStdHours: number;
  payOtHours: number;
  payDtHours: number;
  /** When true the row is not allowed to be modified — only counted. */
  frozen: boolean;
};

export type WeeklySpillResult = {
  /** New pay_std/pay_ot for each non-frozen row, by key. dt is never
   *  changed. */
  adjustments: Map<string, { payStdHours: number; payOtHours: number; reason: string | null }>;
};

/** Rule 4: weekly OT spill. Walks the week chronologically (frozen rows
 *  first since they were finalized earlier), accumulates total hours,
 *  and once cumulative > 40 pushes the spill from pay_std into pay_ot.
 *  Only mutates non-frozen rows. */
export function applyWeeklySpill(rows: WeekHourRow[]): WeeklySpillResult {
  const adjustments = new Map<string, { payStdHours: number; payOtHours: number; reason: string | null }>();

  // Sort: frozen rows first (they already happened), then by workDate.
  const ordered = [...rows].sort((a, b) => {
    if (a.frozen !== b.frozen) return a.frozen ? -1 : 1;
    return a.workDate.localeCompare(b.workDate);
  });

  let cumulative = 0;
  for (const row of ordered) {
    const rowTotal = row.payStdHours + row.payOtHours + row.payDtHours;
    if (row.frozen) {
      cumulative += rowTotal;
      continue;
    }
    const beforeStart = cumulative;
    const beforeStartStd = beforeStart;
    const newStdStart = beforeStartStd; // cumulative-before for naming
    // Skip rows entirely under threshold.
    if (newStdStart + row.payStdHours <= PAYROLL_WEEKLY_OT_THRESHOLD) {
      adjustments.set(row.key, {
        payStdHours: row.payStdHours,
        payOtHours:  row.payOtHours,
        reason: null,
      });
      cumulative += rowTotal;
      continue;
    }
    // Compute spill: how much of this row's pay_std falls past the 40-hr line.
    const remainingStdBudget = Math.max(0, PAYROLL_WEEKLY_OT_THRESHOLD - newStdStart);
    const keepStd = Math.min(row.payStdHours, remainingStdBudget);
    const spill = row.payStdHours - keepStd;
    const r = (n: number) => Math.round(n * 100) / 100;
    adjustments.set(row.key, {
      payStdHours: r(keepStd),
      payOtHours:  r(row.payOtHours + spill),
      reason: spill > 0 ? `+${r(spill)}hr weekly OT spill` : null,
    });
    cumulative += rowTotal;
  }

  return { adjustments };
}

/** Apply per-day rules to a set of candidate rows from the same payroll
 *  candidate list. Groups by (employee_key|null, work_date), computes any
 *  daily bumps (5hr minimum + round-up), and allocates the bumps to the
 *  HIGHEST-PAYING row in that day's group (Connor's rule, 2026-05-31).
 *  Other rows keep their billed std/ot/dt unchanged.
 *
 *  The optional `ratesByRowId` map lets the caller pre-resolve pay rates
 *  per row so the highest-rate selection works. Without it, the bump
 *  goes to the first row in the group (deterministic fallback).
 *
 *  Edge case — zero billed hours on a day (someone keyed all blanks). The
 *  daily rule still bumps to 5 (per Connor's "5hr minimum"). The whole
 *  5hr goes to the highest-rate row, or split equally if all rates are
 *  unknown.
 */
export function applyDailyRulesToCandidates(
  rows: { timesheetEntryId: string; employeeKey: string | null; workDate: string | null;
          stdHours: number; otHours: number; dtHours: number; }[],
  ratesByRowId?: Map<string, number>,
): Map<string, { payStdHours: number; payOtHours: number; payDtHours: number;
                  payTotalHours: number; payAdjustmentReason: string | null; }> {
  type GroupKey = string;
  const groups = new Map<GroupKey, typeof rows>();
  const keyOf = (r: typeof rows[number]) => `${r.employeeKey ?? "__"}|${r.workDate ?? "__"}`;
  for (const r of rows) {
    const k = keyOf(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }

  const out = new Map<string, { payStdHours: number; payOtHours: number; payDtHours: number;
                                  payTotalHours: number; payAdjustmentReason: string | null; }>();
  const round2 = (n: number) => Math.round(n * 100) / 100;

  for (const list of groups.values()) {
    const billedTotal = list.reduce((acc, r) => acc + r.stdHours + r.otHours + r.dtHours, 0);

    // No-show day: nobody worked. Daily rules don't apply — pay is 0.
    // The "Remove zero-hour entries" cleanup button still applies, but
    // even without it the math is correct (no phantom 5hr min).
    if (billedTotal === 0) {
      for (const r of list) {
        out.set(r.timesheetEntryId, {
          payStdHours: 0, payOtHours: 0, payDtHours: 0,
          payTotalHours: 0, payAdjustmentReason: null,
        });
      }
      continue;
    }

    const afterMin   = Math.max(billedTotal, PAYROLL_DAILY_MINIMUM_HOURS);
    const ceilTotal  = Math.ceil(afterMin - 1e-9);
    const dayExtra   = ceilTotal - billedTotal;

    // Pick the row that absorbs the day's bump: highest pay rate among
    // ROWS THAT WORKED (rowBilled > 0). Zero-hour rows can't absorb the
    // minimum — they didn't work. Ties / no-rate-info fall back to the
    // first worked row (deterministic).
    let absorberId: string | null = null;
    if (dayExtra > 1e-9) {
      let maxRate = -Infinity;
      for (const r of list) {
        const rowBilled = r.stdHours + r.otHours + r.dtHours;
        if (rowBilled <= 0) continue;
        const rate = ratesByRowId?.get(r.timesheetEntryId) ?? 0;
        if (rate > maxRate) { maxRate = rate; absorberId = r.timesheetEntryId; }
      }
      if (absorberId == null) {
        // Fall back to first row that actually worked
        for (const r of list) {
          if (r.stdHours + r.otHours + r.dtHours > 0) { absorberId = r.timesheetEntryId; break; }
        }
      }
      // Multiple worked rows but no rates known → equal split across worked rows
      const workedRows = list.filter((r) => r.stdHours + r.otHours + r.dtHours > 0);
      if (maxRate <= 0 && workedRows.length > 1) {
        const reasons: string[] = [];
        if (afterMin > billedTotal) reasons.push("5hr min applied");
        if (ceilTotal > afterMin)   reasons.push("rounded up to whole hour");
        const reason = reasons.length ? reasons.join("; ") + " (split equally — no rates)" : null;
        const share = dayExtra / workedRows.length;
        for (const r of list) {
          const rowBilled = r.stdHours + r.otHours + r.dtHours;
          const extra = rowBilled > 0 ? share : 0;
          out.set(r.timesheetEntryId, {
            payStdHours: round2(r.stdHours + extra),
            payOtHours:  round2(r.otHours),
            payDtHours:  round2(r.dtHours),
            payTotalHours: round2(r.stdHours + extra + r.otHours + r.dtHours),
            payAdjustmentReason: rowBilled > 0 ? reason : null,
          });
        }
        continue;
      }
    }

    const reasons: string[] = [];
    if (afterMin > billedTotal) reasons.push("5hr min applied");
    if (ceilTotal > afterMin)   reasons.push("rounded up to whole hour");
    const reason = reasons.length ? reasons.join("; ") : null;

    for (const r of list) {
      const isAbsorber = r.timesheetEntryId === absorberId;
      const payStd = isAbsorber ? r.stdHours + dayExtra : r.stdHours;
      const payOt  = r.otHours;
      const payDt  = r.dtHours;
      out.set(r.timesheetEntryId, {
        payStdHours: round2(payStd),
        payOtHours:  round2(payOt),
        payDtHours:  round2(payDt),
        payTotalHours: round2(payStd + payOt + payDt),
        payAdjustmentReason: isAbsorber ? reason : null,
      });
    }
  }

  return out;
}

// ─── Pay-rate resolution (Phase 1) ────────────────────────────────────────
// Resolves the pay rate to snapshot onto a payroll_run_entries row.
// Precedence (override-wins, not max — see project_payroll.md):
//   1. Employee override (any of payStdRate/payOtRate/payDtRate set on
//      the employees row wins per-column. NULL means "fall through".)
//   2. Job's pinned rate card (resolveRateCardForJob — honors job_request
//      pinned profile, otherwise client+date lookup)
//   3. Default master rate card (ratecard-master-default)
//
// Returns { stdRate, otRate, dtRate, source } where source identifies
// which layer answered (for debug + UI badges). Any returned rate may
// still be 0 if no layer has a value set — the caller (createPayrollRun
// + addEntriesToPayrollRun) snapshots 0 and the run detail page shows
// the yellow "needs rates" banner.
//
// IMPORTANT: this is the ONLY place pay rates flow out of the system.
// It is NOT called from quote/invoice flows — those use bill rates only.

export type ResolvedPayRate = {
  stdRate: number;
  otRate: number;
  dtRate: number;
  /** Highest-precedence source that contributed any rate. */
  source: "employee" | "jobRateCard" | "defaultRateCard" | "none";
};

type EmployeePayOverride = {
  payStdRate: number | null;
  payOtRate: number | null;
  payDtRate: number | null;
};

/** Fetch an employee's pay-rate override columns. Returns null if the
 *  employee row can't be found. */
async function fetchEmployeePayOverride(employeeKey: string): Promise<EmployeePayOverride | null> {
  const { data, error } = await supabase
    .from("employees")
    .select("pay_std_rate, pay_ot_rate, pay_dt_rate")
    .eq("employee_key", employeeKey)
    .maybeSingle();
  if (error) { console.error("[payroll] fetchEmployeePayOverride:", error); return null; }
  if (!data) return null;
  const r = data as any;
  return {
    payStdRate: r.pay_std_rate == null ? null : Number(r.pay_std_rate),
    payOtRate:  r.pay_ot_rate  == null ? null : Number(r.pay_ot_rate),
    payDtRate:  r.pay_dt_rate  == null ? null : Number(r.pay_dt_rate),
  };
}

/** Look up the pay rate for a specialty on a given rate card. Returns
 *  zeros if the specialty has no matching row or the row has no pay
 *  rates set (pay_hourly = 0 in DB). */
async function payRatesForSpecialtyOnCard(
  profileId: string,
  specialtyId: string | null,
): Promise<{ stdRate: number; otRate: number; dtRate: number }> {
  if (!specialtyId) return { stdRate: 0, otRate: 0, dtRate: 0 };
  const { data, error } = await supabase
    .from("rate_card_profile_rows")
    .select("pay_hourly, pay_ot_rate, pay_dt_rate")
    .eq("profile_id", profileId)
    .eq("specialty_id", specialtyId)
    .maybeSingle();
  if (error) { console.error("[payroll] payRatesForSpecialtyOnCard:", error); return { stdRate: 0, otRate: 0, dtRate: 0 }; }
  if (!data) return { stdRate: 0, otRate: 0, dtRate: 0 };
  const r = data as any;
  return {
    stdRate: Number(r.pay_hourly  ?? 0),
    otRate:  Number(r.pay_ot_rate ?? 0),
    dtRate:  Number(r.pay_dt_rate ?? 0),
  };
}

/** Resolve the pay rate for a single timesheet entry context. */
export async function resolvePayRateForEntry(input: {
  employeeKey?: string | null;
  specialtyId?: string | null;
  jobId?: string | null;
  workDate?: string | null;
}): Promise<ResolvedPayRate> {
  // ─── Layer 1: employee override ─────────────────────────────────────
  let empOverride: EmployeePayOverride | null = null;
  if (input.employeeKey) {
    empOverride = await fetchEmployeePayOverride(input.employeeKey);
  }
  const anyEmpOverride = empOverride && (
    empOverride.payStdRate != null ||
    empOverride.payOtRate  != null ||
    empOverride.payDtRate  != null
  );

  // ─── Layer 2 + 3: rate card (job-pinned → client+date → master) ────
  // Resolved per-column so a partial employee override is honored without
  // forcing the rate-card lookup to be all-or-nothing. The rate-card lookup
  // is cached locally — same job hits one query.
  let cardRates: { stdRate: number; otRate: number; dtRate: number } | null = null;
  let cardSource: "jobRateCard" | "defaultRateCard" | "none" = "none";

  if (input.specialtyId) {
    // Try job-pinned rate card (or job's client+date fallback)
    if (input.jobId) {
      try {
        const card = await resolveRateCardForJob(input.jobId);
        if (card) {
          cardRates = await payRatesForSpecialtyOnCard(card.id, input.specialtyId);
          cardSource = card.id === "ratecard-master-default" ? "defaultRateCard" : "jobRateCard";
        }
      } catch (e) {
        console.error("[payroll] resolvePayRateForEntry job rate card:", e);
      }
    }
    // Fallback: master default by null clientId
    if (!cardRates || (cardRates.stdRate === 0 && cardRates.otRate === 0 && cardRates.dtRate === 0)) {
      try {
        const master = await pickRateCardForJob(null, input.workDate ?? "");
        if (master) {
          cardRates = await payRatesForSpecialtyOnCard(master.id, input.specialtyId);
          cardSource = "defaultRateCard";
        }
      } catch (e) {
        console.error("[payroll] resolvePayRateForEntry master:", e);
      }
    }
  }

  // ─── Combine layers (override wins per-column) ──────────────────────
  const stdRate = empOverride?.payStdRate ?? cardRates?.stdRate ?? 0;
  const otRate  = empOverride?.payOtRate  ?? cardRates?.otRate  ?? 0;
  const dtRate  = empOverride?.payDtRate  ?? cardRates?.dtRate  ?? 0;

  const source: ResolvedPayRate["source"] =
    anyEmpOverride ? "employee" :
    cardRates && cardRates.stdRate > 0 ? cardSource :
    "none";

  return { stdRate, otRate, dtRate, source };
}

/** Pure helper: given a base rate and the hour/holiday context, return the
 *  derived OT/DT rates and total pay. Computes off the PAY buckets — the
 *  billed std/ot/dt buckets are what the client pays, not the employee. */
export function recomputePayFromBase(input: {
  baseRate: number;
  payStdHours: number;
  payOtHours: number;
  payDtHours: number;
  payTotalHours: number;
  isHoliday: boolean;
  holidayMultiplier?: number | null;
}): { stdRate: number; otRate: number; dtRate: number; totalPay: number } {
  const base = Math.max(0, input.baseRate || 0);
  const otRate = +(base * PAYROLL_OT_MULTIPLIER).toFixed(4);
  const dtRate = +(base * PAYROLL_DT_MULTIPLIER).toFixed(4);
  let totalPay: number;
  if (input.isHoliday) {
    const mult = input.holidayMultiplier ?? 2.0;
    totalPay = +(input.payTotalHours * base * mult).toFixed(2);
  } else {
    totalPay = +(
      input.payStdHours * base +
      input.payOtHours  * otRate +
      input.payDtHours  * dtRate
    ).toFixed(2);
  }
  return { stdRate: base, otRate, dtRate, totalPay };
}

/** Update a single payroll_run_entries row's base pay rate. Recomputes
 *  ot_rate / dt_rate / total_pay per Connor's rule (OT=1.5x, DT=2x;
 *  holiday collapses to base × holiday_multiplier). The header rollups
 *  refresh automatically via the refresh_payroll_run_totals trigger.
 *
 *  Blocked by the DB freeze trigger on finalized/exported runs. */
export async function updatePayrollRunEntryBaseRate(
  runEntryId: string,
  baseRate: number,
): Promise<void> {
  // Pull the row so we can recompute against its pay-hour buckets + holiday.
  const { data, error: getErr } = await supabase
    .from("payroll_run_entries")
    .select("pay_std_hours, pay_ot_hours, pay_dt_hours, pay_total_hours, is_holiday, holiday_multiplier")
    .eq("id", runEntryId)
    .single();
  if (getErr) throw getErr;
  const calc = recomputePayFromBase({
    baseRate,
    payStdHours: Number((data as any).pay_std_hours ?? 0),
    payOtHours:  Number((data as any).pay_ot_hours  ?? 0),
    payDtHours:  Number((data as any).pay_dt_hours  ?? 0),
    payTotalHours: Number((data as any).pay_total_hours ?? 0),
    isHoliday: !!(data as any).is_holiday,
    holidayMultiplier: (data as any).holiday_multiplier,
  });
  const { error } = await supabase
    .from("payroll_run_entries")
    .update({
      std_rate: calc.stdRate,
      ot_rate:  calc.otRate,
      dt_rate:  calc.dtRate,
      total_pay: calc.totalPay,
    })
    .eq("id", runEntryId);
  if (error) throw error;
}

/** Re-apply the daily payroll rules (5hr minimum + round-up to next whole
 *  hour) to every entry on a DRAFT run. Groups by (employee_key, work_date)
 *  the same way snapshot does — so daily totals get the floor + ceiling
 *  applied, then allocated back to individual rows proportionally.
 *
 *  Use case: an existing run was seeded via SQL bypass (e.g. Bruno's data
 *  fix), or the operator added entries before Connor's rules were live.
 *  This button lets them bring the run into compliance without removing
 *  and re-adding every row.
 *
 *  total_pay recomputes from the resolved rates × the new pay_* buckets.
 *  Clears ot_calculated_at since weekly totals just changed.
 *
 *  Returns the count of rows updated. */
export async function recomputeDailyRulesForRun(runId: string): Promise<number> {
  const { data: runRow, error: runErr } = await supabase
    .from("payroll_runs").select("status").eq("id", runId).single();
  if (runErr) throw runErr;
  if ((runRow as any).status !== "draft") {
    throw new Error(`Cannot recompute — run is ${(runRow as any).status}. Reopen it first.`);
  }

  const { data, error } = await supabase
    .from("payroll_run_entries")
    .select(`
      id, timesheet_entry_id, employee_key, work_date,
      std_hours, ot_hours, dt_hours,
      std_rate, is_holiday, holiday_multiplier, pay_adjustment_reason
    `)
    .eq("payroll_run_id", runId);
  if (error) throw error;
  if (!data || data.length === 0) return 0;

  // Reuse applyDailyRulesToCandidates by adapting the shape.
  // Pass the row's existing std_rate so the bump routes to the highest-
  // rate row per (employee, date) group.
  const candidateShape = (data as any[]).map((r) => ({
    timesheetEntryId: r.id,  // use run-entry id as the lookup key
    employeeKey: r.employee_key ?? null,
    workDate: r.work_date ?? null,
    stdHours: Number(r.std_hours ?? 0),
    otHours:  Number(r.ot_hours  ?? 0),
    dtHours:  Number(r.dt_hours  ?? 0),
  }));
  const ratesByRowId = new Map<string, number>();
  for (const r of data as any[]) {
    ratesByRowId.set(r.id, Number(r.std_rate ?? 0));
  }
  const dailyAdjustments = applyDailyRulesToCandidates(candidateShape, ratesByRowId);

  let updated = 0;
  for (const r of (data as any[])) {
    const pay = dailyAdjustments.get(r.id);
    if (!pay) continue;
    const calc = recomputePayFromBase({
      baseRate: Number(r.std_rate ?? 0),
      payStdHours: pay.payStdHours,
      payOtHours:  pay.payOtHours,
      payDtHours:  pay.payDtHours,
      payTotalHours: pay.payTotalHours,
      isHoliday: !!r.is_holiday,
      holidayMultiplier: r.holiday_multiplier,
    });

    // Merge the new reason with any pre-existing reason (e.g. weekly OT
    // spill from a prior finalize that was reopened — though in practice
    // a reopen would clear OT calc state).
    const newReason = pay.payAdjustmentReason;
    const existingReason = r.pay_adjustment_reason as string | null;
    const mergedReason =
      newReason && existingReason && !existingReason.includes(newReason)
        ? `${existingReason}; ${newReason}`
        : (newReason ?? existingReason);

    const { error: updErr } = await supabase
      .from("payroll_run_entries")
      .update({
        pay_std_hours: pay.payStdHours,
        pay_ot_hours:  pay.payOtHours,
        pay_dt_hours:  pay.payDtHours,
        pay_total_hours: pay.payTotalHours,
        pay_adjustment_reason: mergedReason,
        std_rate: calc.stdRate,
        ot_rate:  calc.otRate,
        dt_rate:  calc.dtRate,
        total_pay: calc.totalPay,
      })
      .eq("id", r.id);
    if (updErr) throw updErr;
    updated += 1;
  }

  // Hours just moved — any prior OT calc is stale.
  await supabase
    .from("payroll_runs")
    .update({ ot_calculated_at: null, ot_calculated_by: null })
    .eq("id", runId);

  return updated;
}

/** Re-normalize every entry on a draft run: OT = std × 1.5, DT = std × 2,
 *  total_pay recomputed accordingly. Useful after pulling in entries that
 *  were typed with legacy non-multiplier-consistent rates (35/52/70 etc.).
 *  Returns the count of rows updated. */
export async function normalizePayrollRunRates(runId: string): Promise<number> {
  const { data: runRow, error: runErr } = await supabase
    .from("payroll_runs").select("status").eq("id", runId).single();
  if (runErr) throw runErr;
  if ((runRow as any).status !== "draft") {
    throw new Error(`Cannot recalculate — run is ${(runRow as any).status}. Reopen it first.`);
  }
  const { data, error } = await supabase
    .from("payroll_run_entries")
    .select("id, pay_std_hours, pay_ot_hours, pay_dt_hours, pay_total_hours, std_rate, is_holiday, holiday_multiplier")
    .eq("payroll_run_id", runId);
  if (error) throw error;

  let updated = 0;
  for (const r of (data ?? []) as any[]) {
    const calc = recomputePayFromBase({
      baseRate: Number(r.std_rate ?? 0),
      payStdHours: Number(r.pay_std_hours ?? 0),
      payOtHours:  Number(r.pay_ot_hours  ?? 0),
      payDtHours:  Number(r.pay_dt_hours  ?? 0),
      payTotalHours: Number(r.pay_total_hours ?? 0),
      isHoliday: !!r.is_holiday,
      holidayMultiplier: r.holiday_multiplier,
    });
    const { error: updErr } = await supabase
      .from("payroll_run_entries")
      .update({
        std_rate: calc.stdRate,
        ot_rate:  calc.otRate,
        dt_rate:  calc.dtRate,
        total_pay: calc.totalPay,
      })
      .eq("id", r.id);
    if (updErr) throw updErr;
    updated += 1;
  }
  return updated;
}

/** Remove an entry from a draft run. The DB freeze trigger blocks this if
 *  the run is finalized/exported. Also clears the source entry's
 *  payroll_run_id so it leaves the super-freeze. */
export async function removeEntryFromRun(runEntryId: string): Promise<void> {
  // Look up the timesheet_entry_id before deleting, so we can clear the
  // source row's payroll_run_id afterwards.
  const { data: pre, error: lookupErr } = await supabase
    .from("payroll_run_entries")
    .select("timesheet_entry_id")
    .eq("id", runEntryId)
    .single();
  if (lookupErr) throw lookupErr;
  const timesheetEntryId = (pre as any)?.timesheet_entry_id as string | undefined;

  const { error } = await supabase.from("payroll_run_entries").delete().eq("id", runEntryId);
  if (error) throw error;

  if (timesheetEntryId) {
    const { error: clearErr } = await supabase
      .from("timesheet_entries")
      .update({ payroll_run_id: null })
      .eq("id", timesheetEntryId);
    if (clearErr) console.error("[payroll] removeEntryFromRun clear payroll_run_id:", clearErr);
  }
}

/** Count entries on a run that still have a zero pay rate. Used by the
 *  detail UI to surface a banner + disable the Finalize button, and by
 *  finalizePayrollRun() as a server-side guard. */
export async function countUnratedEntries(runId: string): Promise<number> {
  const { count, error } = await supabase
    .from("payroll_run_entries")
    .select("id", { count: "exact", head: true })
    .eq("payroll_run_id", runId)
    .eq("std_rate", 0);
  if (error) { console.error("[payroll] countUnratedEntries:", error); return 0; }
  return count ?? 0;
}

/** Count entries with zero pay hours. Zero-hour rows are usually no-shows
 *  or placeholder timesheets that got pulled into the run by mistake. They
 *  contribute $0 to the total but distort headcount / paystub output, so
 *  the operator should delete them before finalize. */
export async function countZeroHourEntries(runId: string): Promise<number> {
  const { count, error } = await supabase
    .from("payroll_run_entries")
    .select("id", { count: "exact", head: true })
    .eq("payroll_run_id", runId)
    .eq("pay_total_hours", 0);
  if (error) { console.error("[payroll] countZeroHourEntries:", error); return 0; }
  return count ?? 0;
}

/** Bulk-delete every entry on a draft run whose pay_total_hours = 0.
 *  Also releases the source timesheet_entries.payroll_run_id stamps so
 *  they're free to be picked into a future run if reopened/corrected. */
export async function removeZeroHourEntriesFromRun(runId: string): Promise<number> {
  // Look up which entries we're about to drop, so we can clear the
  // super-freeze on their source timesheet entries afterwards.
  const { data: targets, error: lookupErr } = await supabase
    .from("payroll_run_entries")
    .select("id, timesheet_entry_id")
    .eq("payroll_run_id", runId)
    .eq("pay_total_hours", 0);
  if (lookupErr) throw lookupErr;
  if (!targets || targets.length === 0) return 0;

  const ids = (targets as any[]).map((r) => r.id);
  const sourceIds = (targets as any[]).map((r) => r.timesheet_entry_id);

  const { error: delErr } = await supabase
    .from("payroll_run_entries")
    .delete()
    .in("id", ids);
  if (delErr) throw delErr;

  if (sourceIds.length > 0) {
    const { error: clearErr } = await supabase
      .from("timesheet_entries")
      .update({ payroll_run_id: null })
      .in("id", sourceIds);
    if (clearErr) console.error("[payroll] removeZeroHourEntriesFromRun clear payroll_run_id:", clearErr);
  }
  return ids.length;
}

// ─── Weekly OT (rule 4) — applied at finalize time ─────────────────────────
// "Anything over 40 hrs in a Sun-Sat pay week is OT." Computed across THIS
// run + any other FINALIZED runs for the same employee in the same week.
// Approved-but-not-yet-paid timesheet hours don't count — they'll be
// counted when their own run finalizes. (See conversation context for the
// reasoning: relying on finalized runs avoids staleness from unapprove →
// edit → re-approve cycles.)

/** Internal: gather every row contributing to weekly totals for this run,
 *  bucketed by (employee_key, pay_week_start). Marks rows from finalized
 *  runs as frozen so applyWeeklySpill only mutates this run's rows. */
async function gatherWeekRowsForRun(runId: string, weekStart: "sun" | "mon"): Promise<{
  byWeek: Map<string, WeekHourRow[]>;
  thisRunRowIdByEntryId: Map<string, string>;
}> {
  const { data: thisRows, error: thisErr } = await supabase
    .from("payroll_run_entries")
    .select("id, timesheet_entry_id, employee_key, work_date, pay_std_hours, pay_ot_hours, pay_dt_hours")
    .eq("payroll_run_id", runId);
  if (thisErr) throw thisErr;

  const employees = Array.from(new Set(
    (thisRows ?? []).map((r: any) => r.employee_key).filter(Boolean)
  ));
  const workDates = (thisRows ?? []).map((r: any) => r.work_date).filter(Boolean) as string[];
  if (workDates.length === 0 || employees.length === 0) {
    return { byWeek: new Map(), thisRunRowIdByEntryId: new Map() };
  }
  const weeks = Array.from(new Set(workDates.map(d => payWeekStartFor(d, weekStart))));
  // Build a date range covering all weeks: weekStart → weekStart + 6 days.
  const dateMin = weeks.reduce((a, b) => a < b ? a : b);
  const lastWeek = weeks.reduce((a, b) => a > b ? a : b);
  const lastDate = (() => {
    const [y,m,d] = lastWeek.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m-1, d));
    dt.setUTCDate(dt.getUTCDate() + 6);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
  })();

  // Pull entries from FINALIZED (incl. exported) runs for these employees
  // in this date span. Exclude this run itself.
  const { data: priorRows, error: priorErr } = await supabase
    .from("payroll_run_entries")
    .select(`
      id, timesheet_entry_id, payroll_run_id, employee_key, work_date,
      pay_std_hours, pay_ot_hours, pay_dt_hours,
      payroll_runs!inner(status)
    `)
    .in("employee_key", employees)
    .gte("work_date", dateMin)
    .lte("work_date", lastDate)
    .neq("payroll_run_id", runId)
    .in("payroll_runs.status", ["finalized", "exported"]);
  if (priorErr) throw priorErr;

  const byWeek = new Map<string, WeekHourRow[]>();
  const thisRunRowIdByEntryId = new Map<string, string>();
  const pushRow = (employeeKey: string | null, workDate: string, row: WeekHourRow) => {
    const wk = payWeekStartFor(workDate, weekStart);
    const key = `${employeeKey ?? "__"}|${wk}`;
    const list = byWeek.get(key) ?? [];
    list.push(row);
    byWeek.set(key, list);
  };
  for (const r of (thisRows ?? []) as any[]) {
    if (!r.work_date) continue;
    thisRunRowIdByEntryId.set(r.timesheet_entry_id, r.id);
    pushRow(r.employee_key ?? null, r.work_date, {
      key: `this:${r.id}`,
      workDate: r.work_date,
      payStdHours: Number(r.pay_std_hours ?? 0),
      payOtHours:  Number(r.pay_ot_hours  ?? 0),
      payDtHours:  Number(r.pay_dt_hours  ?? 0),
      frozen: false,
    });
  }
  for (const r of (priorRows ?? []) as any[]) {
    if (!r.work_date) continue;
    pushRow(r.employee_key ?? null, r.work_date, {
      key: `prior:${r.id}`,
      workDate: r.work_date,
      payStdHours: Number(r.pay_std_hours ?? 0),
      payOtHours:  Number(r.pay_ot_hours  ?? 0),
      payDtHours:  Number(r.pay_dt_hours  ?? 0),
      frozen: true,
    });
  }

  return { byWeek, thisRunRowIdByEntryId };
}

/** Preview of weekly OT spill — read-only. Returns the proposed
 *  adjustments without writing anything. UI uses this on a draft run to
 *  show "if you finalized right now, here's what would happen". */
export type WeeklyOTPreview = {
  rowId: string;
  payStdHoursBefore: number;
  payOtHoursBefore: number;
  payStdHoursAfter: number;
  payOtHoursAfter: number;
  reason: string;
};

export async function previewWeeklyOT(runId: string): Promise<WeeklyOTPreview[]> {
  const { data: runRow, error: runErr } = await supabase
    .from("payroll_runs").select("pay_week_start, status").eq("id", runId).single();
  if (runErr) throw runErr;
  const weekStart = ((runRow as any).pay_week_start ?? "sun") as "sun" | "mon";

  const { byWeek } = await gatherWeekRowsForRun(runId, weekStart);
  const previews: WeeklyOTPreview[] = [];
  for (const rows of byWeek.values()) {
    const { adjustments } = applyWeeklySpill(rows);
    // We only need to surface CHANGES — rows whose pay_std/pay_ot moved.
    const byKey = new Map(rows.map(r => [r.key, r]));
    for (const [key, adj] of adjustments.entries()) {
      const before = byKey.get(key);
      if (!before) continue;
      if (Math.abs(before.payStdHours - adj.payStdHours) < 0.005) continue;
      // key is "this:<rowId>" for this-run rows.
      const rowId = key.startsWith("this:") ? key.slice(5) : null;
      if (!rowId) continue;
      previews.push({
        rowId,
        payStdHoursBefore: before.payStdHours,
        payOtHoursBefore:  before.payOtHours,
        payStdHoursAfter:  adj.payStdHours,
        payOtHoursAfter:   adj.payOtHours,
        reason: adj.reason ?? "",
      });
    }
  }
  return previews;
}

export async function finalizePayrollRun(id: string): Promise<void> {
  // Guard: refuse to finalize while any entry still has std_rate = 0.
  // The operator must set a base pay rate on every row first (the
  // BaseRateInput on the detail page does this).
  const unrated = await countUnratedEntries(id);
  if (unrated > 0) {
    throw new Error(
      `Cannot finalize — ${unrated} entr${unrated === 1 ? "y has" : "ies have"} no base pay rate set. ` +
      `Fill in the Base $/hr for every row first.`
    );
  }

  // Guard: also refuse to finalize while any entry has zero pay hours.
  // Zero-hour rows are usually no-shows or placeholder timesheets that
  // got pulled into the run by mistake — they contribute $0 but distort
  // headcount and paystub output, so the operator must delete them
  // explicitly. The UI provides a one-click "remove zero-hour entries"
  // affordance for cleanup.
  const zeroHour = await countZeroHourEntries(id);
  if (zeroHour > 0) {
    throw new Error(
      `Cannot finalize — ${zeroHour} entr${zeroHour === 1 ? "y has" : "ies have"} zero pay hours. ` +
      `Remove zero-hour entries first.`
    );
  }

  // Apply weekly OT spill BEFORE flipping the status (so the freeze
  // trigger doesn't block the write).
  const { data: runRow, error: runErr } = await supabase
    .from("payroll_runs").select("pay_week_start").eq("id", id).single();
  if (runErr) throw runErr;
  const weekStart = ((runRow as any).pay_week_start ?? "sun") as "sun" | "mon";

  const { byWeek } = await gatherWeekRowsForRun(id, weekStart);
  for (const rows of byWeek.values()) {
    const { adjustments } = applyWeeklySpill(rows);
    for (const r of rows) {
      if (r.frozen) continue;
      const adj = adjustments.get(r.key);
      if (!adj) continue;
      const movedStd = Math.abs(r.payStdHours - adj.payStdHours) >= 0.005;
      const movedOt  = Math.abs(r.payOtHours  - adj.payOtHours ) >= 0.005;
      // Always recompute total_pay against the post-spill buckets so the
      // header rollup matches what the run actually paid.
      const rowId = r.key.startsWith("this:") ? r.key.slice(5) : null;
      if (!rowId) continue;

      // Pull the current row's rate + holiday context to recompute pay.
      const { data: pre, error: preErr } = await supabase
        .from("payroll_run_entries")
        .select("std_rate, is_holiday, holiday_multiplier, pay_adjustment_reason, pay_dt_hours")
        .eq("id", rowId).single();
      if (preErr) throw preErr;

      const newPayStd = adj.payStdHours;
      const newPayOt  = adj.payOtHours;
      const newPayDt  = Number((pre as any).pay_dt_hours ?? r.payDtHours);
      const newPayTotal = +(newPayStd + newPayOt + newPayDt).toFixed(2);

      const calc = recomputePayFromBase({
        baseRate: Number((pre as any).std_rate ?? 0),
        payStdHours: newPayStd,
        payOtHours:  newPayOt,
        payDtHours:  newPayDt,
        payTotalHours: newPayTotal,
        isHoliday: !!(pre as any).is_holiday,
        holidayMultiplier: (pre as any).holiday_multiplier,
      });

      const existingReason = (pre as any).pay_adjustment_reason as string | null;
      const combinedReason = (movedStd || movedOt) && adj.reason
        ? (existingReason ? `${existingReason}; ${adj.reason}` : adj.reason)
        : existingReason;

      const { error: updErr } = await supabase
        .from("payroll_run_entries")
        .update({
          pay_std_hours: newPayStd,
          pay_ot_hours:  newPayOt,
          pay_total_hours: newPayTotal,
          pay_adjustment_reason: combinedReason,
          ot_rate: calc.otRate,
          dt_rate: calc.dtRate,
          total_pay: calc.totalPay,
        })
        .eq("id", rowId);
      if (updErr) throw updErr;
    }
  }

  // Flip status + stamp OT calc timestamp atomically.
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("payroll_runs")
    .update({
      status: "finalized",
      finalized_at: now,
      ot_calculated_at: now,
    })
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
