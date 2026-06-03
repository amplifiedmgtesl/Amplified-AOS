// Payroll run → CSV dump for the Rippling upload.
//
// One CSV row per timesheet entry on the payroll run. No aggregation, no
// position→specialty mapping. Whatever Amplified has on each entry gets
// emitted verbatim; the payroll clerk reshapes it into Rippling's import
// template (global search/replace on position/specialty if needed).
//
// Rate strategy: push Amplified's stdRate (and stdRate × 1.5 for OT,
// × 2.0 for DT). Lets the clerk see at a glance if Amplified's rates
// are wrong; she can fix them and tell us.

import type { PayrollRun, PayrollRunEntry, EmployeeRecord, JobRequest } from "./types";

function csvField(s: string | number): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}
function hours(n: number): string { return n === 0 ? "" : n.toFixed(4); }
function money(n: number): string { return n === 0 ? "" : n.toFixed(2); }

export function buildRipplingCsv(
  run: PayrollRun,
  entries: PayrollRunEntry[],
  employees: EmployeeRecord[],
  jobs: JobRequest[],
): string {
  const empByKey = new Map<string, EmployeeRecord>();
  for (const e of employees) empByKey.set(e.employeeKey, e);

  const jobByIdNo = new Map<string, string>();  // jobId → jobNo
  for (const j of jobs) jobByIdNo.set(j.id, j.jobNo ?? "");

  const headers = [
    "Rippling Emp No",
    "Employee Name",
    "Work Date",
    "Job",
    "Position",
    "Specialty",
    "Holiday",
    "Std Hours",
    "Std Rate",
    "Std Amount",
    "OT Hours",
    "OT Rate",
    "OT Amount",
    "DT Hours",
    "DT Rate",
    "DT Amount",
    "Total Hours",
    "Total Pay",
    "Adjustment Note",
  ];

  const lines: string[] = [headers.map(csvField).join(",")];

  // Stable order — by employee name, then work date — so the clerk's
  // eye scans down familiar territory.
  const sorted = [...entries].sort((a, b) => {
    const aName = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
    const bName = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim();
    if (aName !== bName) return aName.localeCompare(bName);
    return (a.workDate ?? "").localeCompare(b.workDate ?? "");
  });

  for (const e of sorted) {
    const emp = e.employeeKey ? empByKey.get(e.employeeKey) : undefined;
    const empNo = emp?.ripplingEmployeeId ?? "";
    const name = `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || e.email || "(unknown)";
    const jobNo = e.jobId ? (jobByIdNo.get(e.jobId) ?? "") : "";

    const stdAmt = e.payStdHours * e.stdRate;
    const otAmt  = e.payOtHours  * e.otRate;
    const dtAmt  = e.payDtHours  * e.dtRate;

    lines.push([
      csvField(empNo),
      csvField(name),
      csvField(e.workDate ?? ""),
      csvField(jobNo),
      csvField(e.position ?? ""),
      csvField(e.specialty ?? ""),
      csvField(e.isHoliday ? `Y (${(e.holidayMultiplier ?? 2).toFixed(1)}x)` : ""),
      csvField(hours(e.payStdHours)),
      csvField(e.payStdHours === 0 ? "" : e.stdRate.toFixed(2)),
      csvField(money(stdAmt)),
      csvField(hours(e.payOtHours)),
      csvField(e.payOtHours === 0 ? "" : e.otRate.toFixed(2)),
      csvField(money(otAmt)),
      csvField(hours(e.payDtHours)),
      csvField(e.payDtHours === 0 ? "" : e.dtRate.toFixed(2)),
      csvField(money(dtAmt)),
      csvField(hours(e.payTotalHours)),
      csvField(money(e.totalPay)),
      csvField(e.payAdjustmentReason ?? ""),
    ].join(","));
  }

  return lines.join("\r\n") + "\r\n";
}

export function ripplingCsvFilename(run: PayrollRun): string {
  const short = run.id.slice(0, 6);
  return `amplified-payroll-${run.payDate}-${short}.csv`;
}
