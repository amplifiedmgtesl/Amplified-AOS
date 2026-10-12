// Job Health Check framework — types only.
// Each check is a pure function over a HealthContext that returns Finding[].
// The runner builds the context once per evaluation so checks share data.

import type {
  JobRequest,
  JobRequestDay,
  JobRequestCrewNeed,
  JobRequestAssignment,
  JobRequestShift,
  QuoteDraft,
  InvoiceDraft,
  TimeEntry,
  Specialty,
} from "@/lib/store/types";
import type { RateCardProfile } from "@/lib/rates/defaults";
import type { ComponentMapRow } from "@/lib/store/paychex-export";

/** What the payroll checks need about each person on the job. */
export type HealthEmployee = {
  name: string;
  payrollId: number | null;
  employmentType: string | null;
};

export type Severity = "blocker" | "warning" | "info";

export type FindingCategory =
  | "rate_card"
  | "job"
  | "consistency"
  | "timesheet"
  | "invoice"
  | "payroll";

export type Finding = {
  /** Stable id e.g. "rate_card.no_profile" or "timesheet.missing_specialty:<entryId>". */
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  /** What's wrong, in operator language. */
  detail: string;
  /** What downstream behavior breaks if this isn't fixed. */
  downstream: string;
  /** Optional deep-link to the screen where the fix lives. */
  fixHref?: string;
  fixLabel?: string;
};

export type HealthContext = {
  jobRequest: JobRequest;
  days: JobRequestDay[];
  crewNeeds: JobRequestCrewNeed[];
  assignments: JobRequestAssignment[];
  shifts: JobRequestShift[];
  /** Resolved effective rate card for the job — null if no card resolves. */
  rateCard: RateCardProfile | null;
  /** Source of the rate-card resolution, for diagnostics. */
  rateCardSource: "job_override" | "effective_lookup" | "none";
  /** Non-superseded quotes linked to this job. */
  quotes: QuoteDraft[];
  /** Non-superseded invoices linked to this job. */
  invoices: InvoiceDraft[];
  /** Timesheet entries linked to this job (job_id FK). */
  timesheetEntries: TimeEntry[];
  /** Specialty master — for name lookups in messages. */
  specialties: Specialty[];
  /** Employee records for everyone assigned to or timekept on this job,
   *  keyed by employee_key. A key missing here = no employee record. */
  employeesByKey: Map<string, HealthEmployee>;
  /** false when the employee lookup failed — payroll checks then stay quiet
   *  rather than report everyone as having no employee record. */
  payrollDataLoaded: boolean;
  /** Paychex pay components + company ID (Maintenance → Payroll Export).
   *  null when they couldn't be loaded — payroll checks then skip the
   *  setting-dependent findings rather than guess. */
  payrollComponents: ComponentMapRow[] | null;
  payrollCompanyId: string | null;
};

export type CheckFn = (ctx: HealthContext) => Finding[];
