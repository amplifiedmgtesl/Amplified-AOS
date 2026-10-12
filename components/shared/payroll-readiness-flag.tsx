"use client";

// Small inline flag next to a person on a crew or timekeeping row when
// they'd be left out of the Paychex file (v2.6.0). Same rules as the export
// and the job health check. Renders nothing when the person is ready.

import { useMemo } from "react";
import { loadEmployees } from "@/lib/store/app-store";
import { classifyWorker } from "@/lib/store/paychex-export";

export function payrollGap(
  emp: { ripplingEmployeeId?: number | null; employmentType?: string } | undefined,
): string | null {
  if (!emp) return null; // unlinked rows have their own hint
  if (emp.ripplingEmployeeId == null) return "no Payroll ID";
  if (!classifyWorker(emp.employmentType)) return "Employee/Contractor not set";
  return null;
}

export function PayrollReadinessFlag({ employeeKey }: { employeeKey?: string | null }) {
  const gap = useMemo(() => {
    if (!employeeKey) return null;
    return payrollGap(loadEmployees().find((e) => e.employeeKey === employeeKey));
  }, [employeeKey]);
  if (!gap) return null;
  return (
    <span
      className="hide-print"
      title={`${gap === "no Payroll ID" ? "No Payroll ID on this employee" : "This employee isn't marked Employee or Contractor"} — they'll be left out of the Paychex file. Fix it on the Employee Directory page.`}
      style={{ marginLeft: 6, color: "#c0392b", fontSize: 11, fontStyle: "italic", whiteSpace: "nowrap" }}
    >
      {gap}
    </span>
  );
}
