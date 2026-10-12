// Single registry of all checks. Add new check files here.

import type { CheckFn } from "./types";
import { rateCardChecks } from "./checks/rate-card";
import { jobCompletenessChecks } from "./checks/job-completeness";
import { consistencyChecks } from "./checks/consistency";
import { timesheetInvoiceChecks } from "./checks/timesheet-invoice";
import { crewTimesheetChecks } from "./checks/crew-timesheet";
import { payrollReadinessChecks } from "./checks/payroll-readiness";

export const CHECKS: CheckFn[] = [
  ...rateCardChecks,
  ...jobCompletenessChecks,
  ...consistencyChecks,
  ...timesheetInvoiceChecks,
  ...crewTimesheetChecks,
  ...payrollReadinessChecks,
];
