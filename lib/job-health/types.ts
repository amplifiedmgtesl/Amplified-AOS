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

export type Severity = "blocker" | "warning" | "info";

export type FindingCategory =
  | "rate_card"
  | "job"
  | "consistency"
  | "timesheet"
  | "invoice";

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
};

export type CheckFn = (ctx: HealthContext) => Finding[];
