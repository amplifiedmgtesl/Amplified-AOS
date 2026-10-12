import { describe, it, expect } from "vitest";
import { payrollReadinessChecks } from "@/lib/job-health/checks/payroll-readiness";
import { payrollGap } from "@/components/shared/payroll-readiness-flag";
import type { HealthContext, HealthEmployee } from "@/lib/job-health/types";
import type { ComponentMapRow } from "@/lib/store/paychex-export";

const MAP: ComponentMapRow[] = [
  { workerType: "Employee", payType: "REG", componentName: "Day Rate 1" },
  { workerType: "Employee", payType: "OT", componentName: "" },
  { workerType: "Employee", payType: "DT", componentName: "" },
  { workerType: "Contractor", payType: "REG", componentName: "1099 - Day Rate 1" },
  { workerType: "Contractor", payType: "OT", componentName: "1099 - Day Rate 1" },
  { workerType: "Contractor", payType: "DT", componentName: "1099 - Day Rate 1" },
];

const EMPS = new Map<string, HealthEmployee>([
  ["k-ok", { name: "Ann Ready", payrollId: 101, employmentType: "Contractor" }],
  ["k-noid", { name: "Cy NoId", payrollId: null, employmentType: "Contractor" }],
  ["k-w2", { name: "Bob Wtwo", payrollId: 15, employmentType: "Employee" }],
  ["k-blank", { name: "Di Blank", payrollId: 102, employmentType: null }],
]);

function ctx(p: {
  assigned?: (string | undefined)[];
  entries?: { employeeKey?: string | null; otHours?: number; dtHours?: number; totalHours?: number; firstName?: string }[];
  map?: ComponentMapRow[] | null;
  companyId?: string | null;
  loaded?: boolean;
}): HealthContext {
  return {
    assignments: (p.assigned ?? []).map((k, i) => ({ id: `a${i}`, jobRequestDayId: "d1", employeeKey: k, confirmed: false, sortOrder: i })),
    timesheetEntries: (p.entries ?? []).map((e, i) => ({ id: `t${i}`, totalHours: 8, otHours: 0, dtHours: 0, ...e })),
    employeesByKey: EMPS,
    payrollComponents: p.map === undefined ? MAP : p.map,
    payrollCompanyId: p.companyId === undefined ? "70400794" : p.companyId,
    payrollDataLoaded: p.loaded ?? true,
  } as unknown as HealthContext;
}

function run(c: HealthContext) {
  return payrollReadinessChecks.flatMap((f) => f(c));
}

describe("payroll readiness — who'd be left out of the Paychex file", () => {
  it("is quiet when everyone on the job is ready", () => {
    expect(run(ctx({ assigned: ["k-ok", "k-w2"], entries: [{ employeeKey: "k-ok" }] }))).toEqual([]);
  });

  it("flags a person with no Payroll ID as soon as they're assigned", () => {
    const f = run(ctx({ assigned: ["k-noid"] }));
    expect(f.map((x) => x.id)).toEqual(["payroll.no_payroll_id"]);
    expect(f[0].detail).toBe("Cy NoId");
    expect(f[0].severity).toBe("warning");
  });

  it("counts a person once even if they're on several days and timesheet rows", () => {
    const f = run(ctx({ assigned: ["k-noid", "k-noid"], entries: [{ employeeKey: "k-noid" }] }));
    expect(f[0].title).toBe("1 person has no Payroll ID");
  });

  it("flags an unclear Employee/Contractor setting", () => {
    const f = run(ctx({ entries: [{ employeeKey: "k-blank" }] }));
    expect(f.map((x) => x.id)).toEqual(["payroll.employment_type_unclear"]);
  });

  it("flags timesheet rows not linked to an employee, and keys with no record", () => {
    const f = run(ctx({ entries: [{ employeeKey: null, firstName: "Walk" }, { employeeKey: "k-gone" }] }));
    expect(f.find((x) => x.id === "payroll.no_employee_record")?.title).toBe("2 crew rows aren't linked to an employee");
  });

  it("ignores empty crew slots", () => {
    expect(run(ctx({ assigned: [undefined, undefined] }))).toEqual([]);
  });

  it("stays quiet if the employee lookup failed, rather than flag everyone", () => {
    expect(run(ctx({ assigned: ["k-noid"], entries: [{ employeeKey: null, firstName: "x" }], loaded: false }))).toEqual([]);
  });
});

describe("payroll readiness — W-2 overtime component", () => {
  it("warns when a W-2 has OT and the OT component is blank", () => {
    const f = run(ctx({ entries: [{ employeeKey: "k-w2", otHours: 2 }] }));
    expect(f.map((x) => x.id)).toEqual(["payroll.w2_ot_component_missing"]);
    expect(f[0].title).toBe("W-2 overtime has no Paychex pay component");
  });

  it("doesn't warn for contractor OT", () => {
    expect(run(ctx({ entries: [{ employeeKey: "k-ok", otHours: 2, dtHours: 1 }] }))).toEqual([]);
  });

  it("doesn't warn once the component is filled in", () => {
    const map = MAP.map((m) => (m.workerType === "Employee" ? { ...m, componentName: m.componentName || "Day Rate 1 OT" } : m));
    expect(run(ctx({ entries: [{ employeeKey: "k-w2", otHours: 2, dtHours: 1 }], map }))).toEqual([]);
  });
});

describe("payroll readiness — company ID", () => {
  it("warns when the Paychex Company ID is blank and the job has crew", () => {
    expect(run(ctx({ assigned: ["k-ok"], companyId: "" })).map((x) => x.id)).toEqual(["payroll.no_company_id"]);
  });
  it("says nothing on a job with no crew yet", () => {
    expect(run(ctx({ companyId: "" }))).toEqual([]);
  });
});

describe("payrollGap — the inline flag", () => {
  it("matches the export's rules", () => {
    expect(payrollGap({ ripplingEmployeeId: 1, employmentType: "Contractor" })).toBeNull();
    expect(payrollGap({ ripplingEmployeeId: null, employmentType: "Contractor" })).toBe("no Payroll ID");
    expect(payrollGap({ ripplingEmployeeId: 1, employmentType: "W2" })).toBe("Employee/Contractor not set");
    expect(payrollGap(undefined)).toBeNull();
  });
});
