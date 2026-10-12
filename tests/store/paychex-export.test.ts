import { describe, it, expect } from "vitest";
import {
  buildPaychexCsv,
  classifyWorker,
  paychexCsvFilename,
  PAYCHEX_HEADERS,
  type ComponentMapRow,
  type ExportJobInfo,
  type PayrollExportSettings,
} from "@/lib/store/paychex-export";
import type { EmployeeRecord, PayrollRun, PayrollRunEntry } from "@/lib/store/types";

const RUN = { id: "run-1", payDate: "2026-10-16", payWeekStart: "sun" } as PayrollRun;

const SETTINGS: PayrollExportSettings = { provider: "paychex", companyId: "70400794", jobNameSource: "event_abbr" };

// The seed in 20261012a: one pay code per worker type; OT/DT differ by rate.
const MAP: ComponentMapRow[] = [
  { workerType: "Employee", payType: "REG", componentName: "Day Rate 1" },
  { workerType: "Employee", payType: "OT", componentName: "Day Rate 1" },
  { workerType: "Employee", payType: "DT", componentName: "Day Rate 1" },
  { workerType: "Contractor", payType: "REG", componentName: "1099 - Day Rate 1" },
  { workerType: "Contractor", payType: "OT", componentName: "1099 - Day Rate 1" },
  { workerType: "Contractor", payType: "DT", componentName: "1099 - Day Rate 1" },
];
const MAP_OT_BLANK = MAP.map((m) =>
  m.workerType === "Employee" && m.payType !== "REG" ? { ...m, componentName: "" } : m,
);

const JOBS = new Map<string, ExportJobInfo>([
  ["job-tour", { eventAbbr: "LBFT", eventName: "Luke Bryan Farm Tour" }],
  ["job-wh", { eventAbbr: "WAREHOUS", eventName: "Warehouse" }],
  ["job-old", { eventAbbr: null, eventName: "Louisville Arena Load-in" }],
]);

function emp(key: string, name: string, id: number | null, type: string | undefined): EmployeeRecord {
  const [firstName, ...rest] = name.split(" ");
  return {
    employeeKey: key, fullName: name, firstName, lastName: rest.join(" "),
    employmentType: type, type: type === "Employee" ? "staff" : "contractor",
    ripplingEmployeeId: id,
  } as EmployeeRecord;
}

let seq = 0;
function entry(p: Partial<PayrollRunEntry> & { employeeKey: string; jobId: string }): PayrollRunEntry {
  const std = p.payStdHours ?? 0, ot = p.payOtHours ?? 0, dt = p.payDtHours ?? 0;
  const rate = p.stdRate ?? 25;
  const otRate = p.otRate ?? rate * 1.5, dtRate = p.dtRate ?? rate * 2;
  const total = p.isHoliday
    ? (std + ot + dt) * rate * (p.holidayMultiplier ?? 2)
    : std * rate + ot * otRate + dt * dtRate;
  return {
    id: `e${++seq}`, payrollRunId: "run-1", timesheetEntryId: `t${seq}`,
    stdHours: std, otHours: ot, dtHours: dt, totalHours: std + ot + dt,
    payStdHours: std, payOtHours: ot, payDtHours: dt, payTotalHours: std + ot + dt,
    stdRate: rate, otRate, dtRate, isHoliday: false, totalPay: +total.toFixed(2),
    ...p,
  } as PayrollRunEntry;
}

const EMPLOYEES = [
  emp("k-ann", "Ann Contractor", 101, "Independent Contractor"),
  emp("k-bob", "Bob Worker", 15, "Employee"),
  emp("k-cy", "Cy NoId", null, "Contractor"),
  emp("k-di", "Di Blank", 102, undefined),
  emp("k-ed", "Ed Wtwo", 103, "W2"),
  emp("k-fay", "Fay Dupe", 12, "Contractor"),
  emp("k-fay2", "Faye Dupe", 12, "Contractor"),
];

function rows(csv: string): string[][] {
  return csv.trim().split("\r\n").map((l) => l.split(","));
}

describe("Paychex file layout", () => {
  it("uses Paychex's exact 46-column header, trailing space in 'Job Name ' included", () => {
    const r = buildPaychexCsv(RUN, [], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(PAYCHEX_HEADERS).toHaveLength(46);
    expect(r.csv.split("\r\n")[0]).toBe(PAYCHEX_HEADERS.join(","));
    expect(r.csv.split("\r\n")[0]).toContain(",Job Name ,Pay Component,");
  });

  it("fills only Company ID, Worker ID, Job Name, Pay Component, Rate, Hours", () => {
    const r = buildPaychexCsv(RUN, [entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 30, stdRate: 40 })],
      EMPLOYEES, JOBS, SETTINGS, MAP);
    const [header, line] = rows(r.csv);
    expect(line).toHaveLength(46);
    const filled = Object.fromEntries(header.map((h, i) => [h, line[i]]).filter(([, v]) => v !== ""));
    expect(filled).toEqual({
      "Company ID": "70400794", "Worker ID": "101", "Job Name ": "LBFT",
      "Pay Component": "1099 - Day Rate 1", "Rate": "40", "Hours": "30",
    });
  });

  it("ends lines with CRLF and names the file by pay date", () => {
    const r = buildPaychexCsv(RUN, [], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.csv.endsWith("\r\n")).toBe(true);
    expect(paychexCsvFilename(RUN)).toBe("paychex-payroll-2026-10-16.csv");
  });

  it("passes the component through byte-for-byte (one missing space failed Paychex's first import)", () => {
    const r = buildPaychexCsv(RUN, [entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 8 })],
      EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.lines[0].component).toBe("1099 - Day Rate 1");
  });
});

describe("grouping — one line per worker × job × component × rate", () => {
  it("adds up both weeks of the pay period into one line", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 30, stdRate: 40, workDate: "2026-09-14" }),
      entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 10, stdRate: 40, workDate: "2026-09-21" }),
    ], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].hours).toBe(40);
  });

  it("keeps separate lines for separate jobs and separate rates", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 40, stdRate: 40 }),
      entry({ employeeKey: "k-ann", jobId: "job-wh", payStdHours: 8, stdRate: 25 }),
      entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 8, stdRate: 30 }),
    ], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.lines.map((l) => [l.jobName, l.rate, l.hours])).toEqual([
      ["LBFT", 30, 8], ["LBFT", 40, 40], ["WAREHOUS", 25, 8],
    ]);
  });

  it("merges two AOS records that share one Payroll ID (a known duplicate person)", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-fay", jobId: "job-wh", payStdHours: 9, stdRate: 25 }),
      entry({ employeeKey: "k-fay2", jobId: "job-wh", payStdHours: 5, stdRate: 25 }),
    ], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ workerId: "12", hours: 14 });
  });
});

describe("Job Name source", () => {
  const e = [entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 8 })];
  it("uses the full event name when set to event_name", () => {
    const r = buildPaychexCsv(RUN, e, EMPLOYEES, JOBS, { ...SETTINGS, jobNameSource: "event_name" }, MAP);
    expect(r.lines[0].jobName).toBe("Luke Bryan Farm Tour");
  });
  it("leaves it blank when set to none", () => {
    const r = buildPaychexCsv(RUN, e, EMPLOYEES, JOBS, { ...SETTINGS, jobNameSource: "none" }, MAP);
    expect(r.lines[0].jobName).toBe("");
  });
  it("derives an abbreviation for an older job that has none saved", () => {
    const r = buildPaychexCsv(RUN, [entry({ employeeKey: "k-ann", jobId: "job-old", payStdHours: 5 })],
      EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.lines[0].jobName).toBe("LOUISVIL");
  });
});

describe("overtime", () => {
  it("sends contractor OT and DT on their own lines, same code, OT/DT rate, OT/DT on the job name", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 10, payOtHours: 2, payDtHours: 1, stdRate: 40 }),
    ], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.blockers).toEqual([]);
    expect(r.lines.map((l) => [l.jobName, l.component, l.rate, l.hours])).toEqual([
      ["LBFT", "1099 - Day Rate 1", 40, 10], ["LBFT DT", "1099 - Day Rate 1", 80, 1], ["LBFT OT", "1099 - Day Rate 1", 60, 2],
    ]);
  });

  it("marks OT with just 'OT' when Job Name is set to blank", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 10, payOtHours: 2, stdRate: 40 }),
    ], EMPLOYEES, JOBS, { ...SETTINGS, jobNameSource: "none" }, MAP);
    expect(r.lines.map((l) => l.jobName)).toEqual(["", "OT"]);
  });

  it("stops the export if the W-2 OT code is ever blanked out", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-bob", jobId: "job-tour", payStdHours: 40, payOtHours: 5, stdRate: 40 }),
    ], EMPLOYEES, JOBS, SETTINGS, MAP_OT_BLANK);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]).toContain("Employee OT");
  });

  it("does not block a W-2 with no overtime, even with the OT code blank", () => {
    const r = buildPaychexCsv(RUN, [entry({ employeeKey: "k-bob", jobId: "job-tour", payStdHours: 40, stdRate: 40 })],
      EMPLOYEES, JOBS, SETTINGS, MAP_OT_BLANK);
    expect(r.blockers).toEqual([]);
    expect(r.lines[0]).toMatchObject({ workerId: "15", component: "Day Rate 1", hours: 40 });
  });

  it("sends W-2 OT on its own line under Day Rate 1 at the OT rate", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-bob", jobId: "job-tour", payStdHours: 40, payOtHours: 5, stdRate: 40 }),
    ], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.blockers).toEqual([]);
    expect(r.lines.map((l) => [l.jobName, l.component, l.rate, l.hours])).toEqual([
      ["LBFT", "Day Rate 1", 40, 40], ["LBFT OT", "Day Rate 1", 60, 5],
    ]);
    expect(r.totalPay).toBe(r.expectedPay);
  });
});

describe("holiday", () => {
  it("pays every hour under the regular component at rate × multiplier", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 8, payOtHours: 2, stdRate: 25, isHoliday: true, holidayMultiplier: 2 }),
    ], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.lines.map((l) => [l.component, l.rate, l.hours])).toEqual([["1099 - Day Rate 1", 50, 10]]);
    expect(r.totalPay).toBe(r.expectedPay);
  });
});

describe("left out and reported", () => {
  const r = buildPaychexCsv(RUN, [
    entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 8 }),
    entry({ employeeKey: "k-cy", jobId: "job-tour", payStdHours: 8, stdRate: 25 }),
    entry({ employeeKey: "k-cy", jobId: "job-wh", payStdHours: 2, stdRate: 25 }),
    entry({ employeeKey: "k-di", jobId: "job-tour", payStdHours: 5 }),
    entry({ employeeKey: "k-ed", jobId: "job-tour", payStdHours: 5 }),
    entry({ employeeKey: "k-ghost", jobId: "job-tour", payStdHours: 5, firstName: "Gus", lastName: "Ghost" }),
  ], EMPLOYEES, JOBS, SETTINGS, MAP);

  it("keeps everyone else in the file", () => {
    expect(r.lines.map((l) => l.workerId)).toEqual(["101"]);
  });

  it("lists each left-out person once, with the reason and their hours and pay", () => {
    expect(r.excluded).toEqual([
      { name: "Cy NoId", reason: "No Payroll ID", hours: 10, pay: 250 },
      { name: "Di Blank", reason: "Employee/Contractor not set", hours: 5, pay: 125 },
      { name: "Ed Wtwo", reason: "Employee/Contractor not set", hours: 5, pay: 125 },
      { name: "Gus Ghost", reason: "No employee record", hours: 5, pay: 125 },
    ]);
  });

  it("is not a blocker", () => {
    expect(r.blockers).toEqual([]);
  });
});

describe("totals", () => {
  it("Σ rate × hours in the file equals the run's total pay for the people in it", () => {
    const r = buildPaychexCsv(RUN, [
      entry({ employeeKey: "k-ann", jobId: "job-tour", payStdHours: 10, payOtHours: 2.5, stdRate: 37.5 }),
      entry({ employeeKey: "k-ann", jobId: "job-wh", payStdHours: 6, stdRate: 25 }),
      entry({ employeeKey: "k-bob", jobId: "job-tour", payStdHours: 40, stdRate: 40 }),
    ], EMPLOYEES, JOBS, SETTINGS, MAP);
    expect(r.totalPay).toBe(r.expectedPay);
    expect(r.totalHours).toBe(58.5);
  });

  it("blocks when no Company ID is set", () => {
    const r = buildPaychexCsv(RUN, [], EMPLOYEES, JOBS, { ...SETTINGS, companyId: " " }, MAP);
    expect(r.blockers[0]).toContain("Company ID");
  });
});

describe("classifyWorker", () => {
  it("only exactly 'Employee' is W-2 — same rule as the weekly-OT engine", () => {
    expect(classifyWorker("Employee")).toBe("Employee");
    expect(classifyWorker("W2")).toBeNull();
    expect(classifyWorker("employee ")).toBeNull();
  });
  it("recognises the contractor spellings in use", () => {
    for (const v of ["Contractor", "Independent Contractor", "1099", " contractor "]) {
      expect(classifyWorker(v)).toBe("Contractor");
    }
  });
  it("treats blank as unclear, not contractor", () => {
    expect(classifyWorker("")).toBeNull();
    expect(classifyWorker(undefined)).toBeNull();
  });
});
