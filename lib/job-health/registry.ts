// Single registry of all checks. Add new check files here.

import type { CheckFn } from "./types";
import { rateCardChecks } from "./checks/rate-card";
import { jobCompletenessChecks } from "./checks/job-completeness";
import { consistencyChecks } from "./checks/consistency";
import { timesheetInvoiceChecks } from "./checks/timesheet-invoice";

export const CHECKS: CheckFn[] = [
  ...rateCardChecks,
  ...jobCompletenessChecks,
  ...consistencyChecks,
  ...timesheetInvoiceChecks,
];
