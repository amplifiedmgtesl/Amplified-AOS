import { supabase } from "@/lib/supabase/client";
import { loadQuoteRateHints } from "@/lib/rates/timesheet-group-pricing";

/** How many hours a day-rate day pays.
 *
 *  Two questions, two sources — see docs/day-rate-source-of-truth-design.md:
 *
 *  MODE (is this a day rate at all?) — the QUOTE wins, then the DAY RECORD:
 *    1. the quote line for that (date, specialty), if one exists. This is
 *       the per-specialty override: a specialty explicitly sold hourly on
 *       an otherwise day-rate day stays hourly.
 *    2. otherwise the job day record for that date. This is what covers
 *       anyone working a specialty that was never quoted — the point of
 *       the design, since a day record exists for every day of a job
 *       regardless of what was sold.
 *    3. otherwise hourly.
 *
 *  HOURS (how long is the block?) — the DAY RECORD, and nothing else:
 *    `job_request_days.day_rate_hours`. Full stop.
 *
 *  There is deliberately NO fallback for the hours. Earlier versions
 *  derived them as `round(base_day / base_hourly)` off the quote line, and
 *  that division is wrong whenever the two rates were not set consistently:
 *  on AES_26091720_LFT_FARMTOUR a flat $650/day was quoted with base_hourly
 *  left at each role's rate-card default, yielding 17- and 19-hour "days"
 *  nobody sold. Across every issued quote in prod the derivation and the
 *  day record disagreed 8 times, and the day record was right all 8.
 *
 *  A fallback would silently paper over exactly the case it cannot get
 *  right, so a day that resolves to day-rate mode with no hours on its day
 *  record is a HARD ERROR (see `problems`) rather than a guess. Fix the
 *  day record.
 *
 *  WHICH day record: always `job_request_days`. `quote_days` and
 *  `invoice_days` carry the same two columns (migration 20260830b) but are
 *  frozen document snapshots and payroll must NOT read them —
 *
 *    * only the job record is guaranteed to exist for every worked day. A
 *      quote covers what was sold and an invoice what was billed; Neon
 *      Nights 2026-08-17 was neither, which is the gap this design exists
 *      to close.
 *    * payroll often runs before invoicing, and invoices get revised, so a
 *      document may not exist when the run is built.
 *    * they answer a different question: letting a quote explain the basis
 *      it was issued under, even after the job changes. Payroll pays for
 *      work that happened.
 *
 *  The job record being mutable is not a risk here: hours are snapshotted
 *  onto payroll_run_entries at run creation and finalized runs are frozen,
 *  so a later edit cannot alter a run that already closed. A job whose day
 *  basis drifts from its issued quote is a data problem worth surfacing as
 *  a job-health check — not a reason to pay from a document.
 */
export type DayRateResolver = {
  /** Hours the day rate covers for this row, or null when the row is not
   *  day rate and should pay clock time. */
  hoursFor(
    jobId: string | null | undefined,
    workDate: string | null | undefined,
    specialtyId: string | null | undefined,
  ): number | null;
  /** Rows that resolved to day-rate mode with no usable hours on the day
   *  record. Populated as `hoursFor` is called. Callers MUST check this
   *  after resolving every row and refuse to snapshot if it is non-empty —
   *  otherwise those rows quietly fall back to clock time, which is the
   *  behaviour this design exists to remove. */
  readonly problems: string[];
};

type Mode = "day" | "hourly";

/** Dates arrive as `date` from job_request_days, `text` from quote_lines and
 *  as ISO-ish strings from payroll rows. Compare on the YYYY-MM-DD prefix. */
function dayKey(d: string | null | undefined): string {
  return (d ?? "").slice(0, 10);
}

/** The quote payroll should follow: the latest issued, non-superseded quote
 *  — what was actually sold. An open draft revision is deliberately NOT
 *  preferred. Falls back to a draft only when none was ever issued. */
async function resolvePayrollQuoteIdForJob(jobId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, is_draft, status, updated_at")
    .eq("job_request_id", jobId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.warn("[payroll-day-rate] could not load quotes for job", jobId, error.message);
    return null;
  }
  const rows = (data ?? []) as any[];
  return (rows.find((r) => !r.is_draft && r.status !== "superseded") ?? rows.find((r) => r.is_draft))?.id ?? null;
}

export async function loadDayRateResolver(
  jobIds: (string | null | undefined)[],
): Promise<DayRateResolver> {
  const dayByJobDate = new Map<string, { mode: Mode; hours: number | null }>();
  const quoteModeByJobDateSpecialty = new Map<string, Mode>();
  const problems: string[] = [];
  const seenProblem = new Set<string>();

  const unique = Array.from(new Set(jobIds.filter((j): j is string => !!j)));

  await Promise.all(unique.map(async (jobId) => {
    try {
      const { data, error } = await supabase
        .from("job_request_days")
        .select("event_date, rate_mode, day_rate_hours")
        .eq("job_request_id", jobId);
      if (error) {
        console.warn("[payroll-day-rate] could not load day records for job", jobId, error.message);
      } else {
        for (const r of (data ?? []) as any[]) {
          // NULL rate_mode means the day predates these columns; record
          // nothing and let the quote decide, as it did before.
          if (r.rate_mode !== "day" && r.rate_mode !== "hourly") continue;
          dayByJobDate.set(`${jobId}|${dayKey(r.event_date)}`, {
            mode: r.rate_mode,
            hours: r.day_rate_hours == null ? null : Number(r.day_rate_hours),
          });
        }
      }

      const quoteId = await resolvePayrollQuoteIdForJob(jobId);
      if (!quoteId) return;
      // Same lookup the invoice pricing path uses, so pay and bill agree on
      // which (date, specialty) pairs were sold as day rate. Only the MODE
      // is taken from here — never the hours.
      const hints = await loadQuoteRateHints(quoteId);
      hints.forEach((hint, key) => {
        const [quoteDate, specialtyId] = key.split("|");
        quoteModeByJobDateSpecialty.set(
          `${jobId}|${dayKey(quoteDate)}|${specialtyId}`,
          hint.rateMode === "day" ? "day" : "hourly",
        );
      });
    } catch (e) {
      console.warn("[payroll-day-rate] day-rate lookup failed for job", jobId, e);
    }
  }));

  return {
    problems,
    hoursFor(jobId, workDate, specialtyId) {
      if (!jobId || !workDate) return null;
      const d = dayKey(workDate);

      const day = dayByJobDate.get(`${jobId}|${d}`);
      const quoteMode = specialtyId
        ? quoteModeByJobDateSpecialty.get(`${jobId}|${d}|${specialtyId}`)
        : undefined;

      const mode: Mode = quoteMode ?? day?.mode ?? "hourly";
      if (mode !== "day") return null;

      const hours = day?.hours ?? null;
      if (!(hours && hours > 0)) {
        const msg = day
          ? `${d} is set to Day Rate but has no day-rate hours`
          : `${d} is quoted as a day rate but the job has no day record for it`;
        if (!seenProblem.has(msg)) { seenProblem.add(msg); problems.push(msg); }
        return null;
      }
      return hours;
    },
  };
}

/** Shared message for the guard every snapshot path applies. */
export function dayRateProblemError(problems: string[]): Error {
  return new Error(
    `Cannot build this payroll run — ${problems.length} day${problems.length === 1 ? "" : "s"} ` +
    `resolve to a day rate with no hours set:\n\n` +
    problems.map((p) => `  • ${p}`).join("\n") +
    `\n\nSet the Day Rate hours on the job's Daily Requirements, then try again.`,
  );
}
