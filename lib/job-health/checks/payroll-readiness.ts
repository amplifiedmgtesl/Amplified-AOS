// Payroll-readiness checks (v2.6.0, Paychex). Flags, as early as crew
// assignment, anything that would leave a person out of the Paychex file or
// stop the export: no employee record, no Payroll ID, no clear
// Employee/Contractor setting, and W-2 overtime with no Paychex component.
//
// Same rules as buildPaychexCsv (lib/store/paychex-export.ts) so the health
// check and the export never disagree about who's ready.

import { classifyWorker } from "@/lib/store/paychex-export";
import type { CheckFn, Finding, HealthContext } from "../types";

/** Everyone on the job, by employee_key, plus the timesheet rows that aren't
 *  linked to an employee at all. Crew assignments with no one picked yet are
 *  empty slots, not a payroll problem, so they're skipped. */
function peopleOnJob(ctx: HealthContext) {
  const keys = new Set<string>();
  for (const a of ctx.assignments) if (a.employeeKey) keys.add(a.employeeKey);
  let unlinkedRows = 0;
  for (const e of ctx.timesheetEntries) {
    if (e.employeeKey) keys.add(e.employeeKey);
    else if ((e.totalHours ?? 0) > 0 || e.firstName || e.lastName) unlinkedRows++;
  }
  return { keys: [...keys], unlinkedRows };
}

function nameList(names: string[]): string {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  return sorted.length <= 8 ? sorted.join(", ") : `${sorted.slice(0, 8).join(", ")} and ${sorted.length - 8} more`;
}

const LEFT_OUT = "They'll be left out of the Paychex file and have to be entered in Paychex by hand.";

export const payrollReadinessChecks: CheckFn[] = [
  // 1. No Payroll ID / unclear Employee-Contractor / no employee record
  (ctx) => {
    if (!ctx.payrollDataLoaded) return [];
    const { keys, unlinkedRows } = peopleOnJob(ctx);
    const noRecord: string[] = [];
    const noId: string[] = [];
    const unclear: string[] = [];
    for (const k of keys) {
      const emp = ctx.employeesByKey.get(k);
      if (!emp) { noRecord.push(k); continue; }
      if (emp.payrollId == null) noId.push(emp.name);
      else if (!classifyWorker(emp.employmentType)) unclear.push(emp.name);
    }

    const findings: Finding[] = [];
    if (noId.length) {
      findings.push({
        id: "payroll.no_payroll_id",
        severity: "warning",
        category: "payroll",
        title: `${noId.length} ${noId.length === 1 ? "person has" : "people have"} no Payroll ID`,
        detail: nameList(noId),
        downstream: LEFT_OUT,
        fixHref: "/employee-directory",
        fixLabel: "Add the Payroll ID on the employee's record",
      });
    }
    if (unclear.length) {
      findings.push({
        id: "payroll.employment_type_unclear",
        severity: "warning",
        category: "payroll",
        title: `${unclear.length} ${unclear.length === 1 ? "person isn't" : "people aren't"} marked Employee or Contractor`,
        detail: nameList(unclear),
        downstream: `Paychex needs to know W-2 vs 1099. ${LEFT_OUT}`,
        fixHref: "/employee-directory",
        fixLabel: "Set Employment Type on the employee's record",
      });
    }
    if (noRecord.length || unlinkedRows) {
      const n = noRecord.length + unlinkedRows;
      findings.push({
        id: "payroll.no_employee_record",
        severity: "warning",
        category: "payroll",
        title: `${n} crew ${n === 1 ? "row isn't" : "rows aren't"} linked to an employee`,
        detail: "Pick the person from the employee list on the crew or timekeeping row.",
        downstream: LEFT_OUT,
      });
    }
    return findings;
  },

  // 2. W-2 overtime with no Paychex OT/DT component set
  (ctx) => {
    if (!ctx.payrollDataLoaded || !ctx.payrollComponents) return [];
    const blank = (payType: "OT" | "DT") =>
      !(ctx.payrollComponents!.find((c) => c.workerType === "Employee" && c.payType === payType)?.componentName ?? "").trim();
    const missing: string[] = [];
    const names = new Set<string>();
    let needOt = false, needDt = false;
    for (const e of ctx.timesheetEntries) {
      if (!e.employeeKey) continue;
      const emp = ctx.employeesByKey.get(e.employeeKey);
      if (!emp || classifyWorker(emp.employmentType) !== "Employee") continue;
      const ot = (e.otHours ?? 0) > 0 && blank("OT");
      const dt = (e.dtHours ?? 0) > 0 && blank("DT");
      if (ot) needOt = true;
      if (dt) needDt = true;
      if (ot || dt) names.add(emp.name);
    }
    if (needOt) missing.push("overtime");
    if (needDt) missing.push("double time");
    if (!missing.length) return [];
    return [{
      id: "payroll.w2_ot_component_missing",
      severity: "warning",
      category: "payroll",
      title: `W-2 ${missing.join(" and ")} has no Paychex pay component`,
      detail: `${nameList([...names])} ${names.size === 1 ? "has" : "have"} ${missing.join("/")} hours on this job.`,
      downstream: "The Paychex export won't run for a payroll that includes these hours until the component name is filled in.",
      fixHref: "/maintenance",
      fixLabel: "Maintenance → Payroll Export",
    }];
  },

  // 3. No Paychex Company ID (company-wide, but surfaced wherever payroll
  //    will be affected — only on jobs that actually have crew).
  (ctx) => {
    if (ctx.payrollCompanyId == null || ctx.payrollCompanyId.trim()) return [];
    if (peopleOnJob(ctx).keys.length === 0) return [];
    return [{
      id: "payroll.no_company_id",
      severity: "warning",
      category: "payroll",
      title: "No Paychex Company ID is set",
      detail: "The Company ID goes on every line of the Paychex file.",
      downstream: "The Paychex export won't run until it's set.",
      fixHref: "/maintenance",
      fixLabel: "Maintenance → Payroll Export",
    }];
  },
];
