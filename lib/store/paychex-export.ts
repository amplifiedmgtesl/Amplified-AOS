// Payroll run → Paychex Standard Payroll Import (SPI) CSV.
//
// Paychex's template has 46 columns and a fixed layout (it can't be
// re-mapped on import), so the header below is copied byte-for-byte from the
// file Paychex sent on 2026-10-06 — including the trailing space in
// "Job Name ". Only six columns are filled: Company ID, Worker ID, Job Name,
// Pay Component, Rate, Hours.
//
// Decisions (John, 2026-10-11 — see backlog #115):
//   • One line per worker × job × pay component × rate, summed across the
//     whole pay period. No Line Date. Weekly OT was already worked out per
//     week by the payroll engine, so summing afterwards changes nothing.
//   • Pay component comes from payroll_component_map, keyed on worker type
//     (Employee / Contractor) and pay type (REG / OT / DT). It must match
//     Flex EXACTLY — never trimmed or re-cased here.
//   • OT and DT go on their own line, under the same pay code as regular
//     time (Paychex, 10/12), at the OT/DT rate, with " OT" / " DT" added to
//     the Job Name so they stand out (Connor's request). A blank component
//     in the map STOPS the export (blocker).
//   • Holiday entries pay all hours at base × holiday multiplier under the
//     REG component, so the dollars match AOS's total_pay.
//   • Anyone with no Payroll ID, or no clear Employee/Contractor setting, is
//     LEFT OUT and reported — the rest of the run still exports.
//   • Rate is the rate the payroll run already computed. No other source.

import type { PayrollRun, PayrollRunEntry, EmployeeRecord } from "./types";

export const PAYCHEX_HEADERS = [
  "Company ID", "Worker ID", "Org", "Job Number", "Job Name ", "Pay Component",
  "Rate", "Rate #", "Hours", "Units", "Line Date", "Amount", "Check Seq Number",
  "Override State", "Override Local", "Override Local Jurisdiction",
  "Labor Override", "Check Template", "Output Type", "Net Pay", "Check Number",
  "FIT Amt", "SS Amt", "Medicare Amt", "Fed Backup Withholding Amt",
  "State Tax Jurisdiction", "SIT Amount", "SDI Amt", "Fam Leave", "Med Leave",
  "Parental Leave", "SUI Amt", "State Misc Amt", "State Surcharge Amt",
  "State WC Amt", "State Transit Tax", "LTC Tax",
  "State Backup Withholding Amt", "State Allocation %",
  "Local Tax Jurisdiction", "Local Tax Name", "Local Amt",
  "Local Allocation %", "Start Date", "End Date", "Job Start Date",
] as const;

export type WorkerType = "Employee" | "Contractor";
export type PayType = "REG" | "OT" | "DT";
export type JobNameSource = "event_abbr" | "event_name" | "none";

export type PayrollExportSettings = {
  provider: "paychex";
  companyId: string;
  jobNameSource: JobNameSource;
};

export type ComponentMapRow = {
  workerType: WorkerType;
  payType: PayType;
  componentName: string;
};

export type ExportJobInfo = { eventAbbr?: string | null; eventName?: string | null };

export type PaychexLine = {
  workerId: string;
  name: string;
  jobName: string;
  component: string;
  rate: number;
  hours: number;
};

export type ExcludedWorker = {
  name: string;
  reason: string;
  hours: number;
  pay: number;
};

export type PaychexExportResult = {
  csv: string;
  lines: PaychexLine[];
  excluded: ExcludedWorker[];
  /** Problems that make the file unsafe to upload — the caller must not
   *  offer the download while any exist. */
  blockers: string[];
  totalHours: number;
  totalPay: number;
  /** total_pay of the entries that made it into the file — should equal
   *  totalPay (Σ rate × hours) to the cent. */
  expectedPay: number;
};

/** Classify an employees.employment_type value. Only exactly "Employee"
 *  counts as W-2 — the same rule the weekly-OT engine uses, so a person
 *  can never be W-2 for one and 1099 for the other. Known contractor
 *  spellings map to Contractor; anything else (blank, "W2", typos) is
 *  unclear and the person is left out. The DB trigger added in
 *  20261012a makes every row one of the two values going forward. */
export function classifyWorker(employmentType: string | null | undefined): WorkerType | null {
  const v = (employmentType ?? "").trim();
  if (v === "Employee") return "Employee";
  const lc = v.toLowerCase();
  if (lc === "contractor" || lc === "independent contractor" || lc === "1099") return "Contractor";
  return null;
}

function num(n: number): string {
  // Plain numbers like Paychex's own file ("40", "37.5"), never "40.0000".
  return String(+n.toFixed(4));
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function entryName(e: PayrollRunEntry): string {
  return `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || e.email || "(unknown)";
}

export function buildPaychexCsv(
  run: PayrollRun,
  entries: PayrollRunEntry[],
  employees: EmployeeRecord[],
  jobsById: Map<string, ExportJobInfo>,
  settings: PayrollExportSettings,
  componentMap: ComponentMapRow[],
): PaychexExportResult {
  void run;
  const empByKey = new Map<string, EmployeeRecord>();
  for (const e of employees) empByKey.set(e.employeeKey, e);

  const component = new Map<string, string>();
  for (const c of componentMap) component.set(`${c.workerType}|${c.payType}`, c.componentName ?? "");

  const blockers = new Set<string>();
  if (!settings.companyId.trim()) blockers.add("No Paychex Company ID is set (Maintenance → Payroll Export).");

  const excludedByPerson = new Map<string, ExcludedWorker>();
  const lineByKey = new Map<string, PaychexLine>();
  let expectedPay = 0;

  function jobNameFor(jobId: string | undefined): string {
    if (!jobId || settings.jobNameSource === "none") return "";
    const j = jobsById.get(jobId);
    if (!j) return "";
    if (settings.jobNameSource === "event_name") return (j.eventName ?? "").trim();
    const abbr = (j.eventAbbr ?? "").trim();
    if (abbr) return abbr;
    // Same rule as defaultEventAbbr — jobs saved before the abbr existed.
    return (j.eventName ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8);
  }

  for (const e of entries) {
    const hours = e.payStdHours + e.payOtHours + e.payDtHours;
    if (hours <= 0 && (e.totalPay ?? 0) <= 0) continue;

    const emp = e.employeeKey ? empByKey.get(e.employeeKey) : undefined;
    const name = emp?.fullName?.trim() || entryName(e);
    const personKey = e.employeeKey || name;
    const payrollId = emp?.ripplingEmployeeId;
    const workerType = emp ? classifyWorker(emp.employmentType) : null;

    let reason: string | null = null;
    if (!emp) reason = "No employee record";
    else if (payrollId == null) reason = "No Payroll ID";
    else if (!workerType) reason = "Employee/Contractor not set";
    if (reason) {
      const x = excludedByPerson.get(personKey) ?? { name, reason, hours: 0, pay: 0 };
      x.hours += hours;
      x.pay += e.totalPay ?? 0;
      excludedByPerson.set(personKey, x);
      continue;
    }

    const workerId = String(payrollId);
    const jobName = jobNameFor(e.jobId);
    expectedPay += e.totalPay ?? 0;

    const parts: { payType: PayType; hours: number; rate: number }[] = [];
    if (e.isHoliday) {
      const mult = e.holidayMultiplier ?? 2.0;
      parts.push({ payType: "REG", hours: e.payTotalHours || hours, rate: +(e.stdRate * mult).toFixed(4) });
    } else {
      parts.push({ payType: "REG", hours: e.payStdHours, rate: e.stdRate });
      parts.push({ payType: "OT", hours: e.payOtHours, rate: e.otRate });
      parts.push({ payType: "DT", hours: e.payDtHours, rate: e.dtRate });
    }

    for (const p of parts) {
      if (p.hours <= 0) continue;
      const comp = component.get(`${workerType}|${p.payType}`) ?? "";
      if (!comp) {
        blockers.add(
          `No Paychex pay component is set for ${workerType} ${p.payType === "REG" ? "regular" : p.payType} hours ` +
          `(needed for ${name}). Set it in Maintenance → Payroll Export.`,
        );
        continue;
      }
      const lineJob = p.payType === "REG" ? jobName : [jobName, p.payType].filter(Boolean).join(" ");
      const key = `${workerId}|${lineJob}|${comp}|${num(p.rate)}`;
      const line = lineByKey.get(key) ?? { workerId, name, jobName: lineJob, component: comp, rate: p.rate, hours: 0 };
      line.hours += p.hours;
      lineByKey.set(key, line);
    }
  }

  const lines = [...lineByKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.jobName.localeCompare(b.jobName)
      || a.component.localeCompare(b.component) || a.rate - b.rate,
  );

  const out: string[] = [PAYCHEX_HEADERS.join(",")];
  for (const l of lines) {
    const cells: Record<string, string> = {
      "Company ID": settings.companyId.trim(),
      "Worker ID": l.workerId,
      "Job Name ": l.jobName,
      "Pay Component": l.component,
      "Rate": num(l.rate),
      "Hours": num(l.hours),
    };
    out.push(PAYCHEX_HEADERS.map((h) => csvCell(cells[h] ?? "")).join(","));
  }

  const totalHours = +lines.reduce((s, l) => s + l.hours, 0).toFixed(4);
  const totalPay = +lines.reduce((s, l) => s + l.hours * l.rate, 0).toFixed(2);
  const excluded = [...excludedByPerson.values()]
    .map((x) => ({ ...x, hours: +x.hours.toFixed(4), pay: +x.pay.toFixed(2) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    csv: out.join("\r\n") + "\r\n",
    lines,
    excluded,
    blockers: [...blockers],
    totalHours,
    totalPay,
    expectedPay: +expectedPay.toFixed(2),
  };
}

export function paychexCsvFilename(run: PayrollRun): string {
  return `paychex-payroll-${run.payDate}.csv`;
}
