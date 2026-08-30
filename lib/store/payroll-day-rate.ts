import { supabase } from "@/lib/supabase/client";
import { loadQuoteRateHints } from "@/lib/rates/timesheet-group-pricing";
import { deriveDayFloor } from "@/lib/rates/day-floor";

/** How many hours a day-rate day pays.
 *
 *  Resolution splits deliberately — see
 *  docs/day-rate-source-of-truth-design.md:
 *
 *  MODE (is this a day rate at all?) — the quote wins:
 *    1. the QUOTE LINE for that (date, specialty), if one exists. This is
 *       the per-specialty override: a specialty explicitly sold hourly on
 *       an otherwise day-rate day stays hourly.
 *    2. otherwise the JOB DAY RECORD for that date. This is what covers
 *       anyone working a specialty that was never quoted — the point of
 *       the whole design, since a day record exists for every day of a job
 *       regardless of what was sold.
 *    3. otherwise hourly.
 *
 *  HOURS (how long is the block?) — the DAY RECORD wins:
 *    1. `job_request_days.day_rate_hours`, a number a human entered.
 *    2. otherwise `round(base_day / base_hourly)` off the quote line — a
 *       division artifact, kept only as the fallback for days not yet
 *       backfilled.
 *
 *  The hours precedence is the opposite of the mode precedence on purpose.
 *  Verified against prod 2026-08-30: across every issued quote, the two
 *  disagree 8 times and the day record is right all 8. On
 *  AES_26091720_LFT_FARMTOUR a flat $650/day was quoted with base_hourly
 *  left at each role's rate-card default, so the division yields 17-hour
 *  and 19-hour blocks for Telendler and Steward. Nobody sold a 19-hour day;
 *  the day record says 10, and so do the quote's own `hours` field and
 *  Labor on the identical $650.
 */
export type DayRateResolver = {
  /** Hours the day rate covers for this row, or null when it is not a
   *  day-rate row and should pay clock time. */
  hoursFor(
    jobId: string | null | undefined,
    workDate: string | null | undefined,
    specialtyId: string | null | undefined,
  ): number | null;
};

type Basis = { mode: "day" | "hourly"; hours: number | null };

/** Dates arrive as `date` from job_request_days, `text` from quote_lines and
 *  as ISO-ish strings from payroll rows. Compare on the YYYY-MM-DD prefix. */
function dayKey(d: string | null | undefined): string {
  return (d ?? "").slice(0, 10);
}

/** The quote payroll should follow for a job: the latest issued,
 *  non-superseded quote — what was actually sold. An open draft revision is
 *  deliberately NOT preferred; payroll pays against the agreed quote, not a
 *  work in progress. Falls back to a draft only when none was ever issued. */
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

/** Day-rate basis per date, straight off the job's day records. */
async function loadDayBasis(jobId: string): Promise<Map<string, Basis>> {
  const out = new Map<string, Basis>();
  const { data, error } = await supabase
    .from("job_request_days")
    .select("event_date, rate_mode, day_rate_hours")
    .eq("job_request_id", jobId);
  if (error) {
    console.warn("[payroll-day-rate] could not load day records for job", jobId, error.message);
    return out;
  }
  for (const r of (data ?? []) as any[]) {
    // NULL rate_mode means "not migrated / fall back to the quote", which is
    // the pre-existing behaviour — record nothing so the quote decides.
    if (r.rate_mode !== "day" && r.rate_mode !== "hourly") continue;
    const hours = r.day_rate_hours == null ? null : Number(r.day_rate_hours);
    out.set(dayKey(r.event_date), { mode: r.rate_mode, hours });
  }
  return out;
}

export async function loadDayRateResolver(
  jobIds: (string | null | undefined)[],
): Promise<DayRateResolver> {
  const dayByJobDate = new Map<string, Basis>();
  const quoteByJobDateSpecialty = new Map<string, Basis>();

  const unique = Array.from(new Set(jobIds.filter((j): j is string => !!j)));

  await Promise.all(unique.map(async (jobId) => {
    try {
      const days = await loadDayBasis(jobId);
      days.forEach((basis, d) => dayByJobDate.set(`${jobId}|${d}`, basis));

      const quoteId = await resolvePayrollQuoteIdForJob(jobId);
      if (!quoteId) return;
      // Same lookup the invoice pricing path uses, so pay and bill agree on
      // which (date, specialty) pairs were sold as day rate.
      const hints = await loadQuoteRateHints(quoteId);
      hints.forEach((hint, key) => {
        const [quoteDate, specialtyId] = key.split("|");
        const isDay = hint.rateMode === "day";
        // deriveDayFloor can return 0 when a day rate is worth less than one
        // hour at the hourly rate (backlog #36, the BUYOUT row). On the bill
        // side that means everything overflows; on the PAY side it would pay
        // nothing for a day worked. Treat it as no override and let the day
        // record answer instead.
        const hours = isDay ? deriveDayFloor(hint.baseDay, hint.baseHourly) : null;
        if (isDay && !(hours && hours > 0)) return;
        quoteByJobDateSpecialty.set(
          `${jobId}|${dayKey(quoteDate)}|${specialtyId}`,
          { mode: isDay ? "day" : "hourly", hours },
        );
      });
    } catch (e) {
      console.warn("[payroll-day-rate] day-rate lookup failed for job", jobId, e);
    }
  }));

  return {
    hoursFor(jobId, workDate, specialtyId) {
      if (!jobId || !workDate) return null;
      const d = dayKey(workDate);

      const day = dayByJobDate.get(`${jobId}|${d}`);
      const quote = specialtyId
        ? quoteByJobDateSpecialty.get(`${jobId}|${d}|${specialtyId}`)
        : undefined;

      // ── Mode: the quote line overrides the day, the day covers the rest.
      const mode = quote?.mode ?? day?.mode ?? "hourly";
      if (mode !== "day") return null;

      // ── Hours: the day record's entered number beats the quote's
      //    division. Fall back to the derivation for days not backfilled.
      const hours = (day?.hours && day.hours > 0) ? day.hours : quote?.hours ?? null;
      return hours && hours > 0 ? hours : null;
    },
  };
}
