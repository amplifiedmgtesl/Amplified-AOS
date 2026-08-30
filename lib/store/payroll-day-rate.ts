import { supabase } from "@/lib/supabase/client";
import { loadQuoteRateHints } from "@/lib/rates/timesheet-group-pricing";
import { dayRateCoveredHours, isDayRateHoursDerivable } from "@/lib/rates/day-rate";

/** Day-rate context for one (job, date, specialty): how many hours the
 *  quoted day rate covers, and whether that number was derived from real
 *  figures or fell back to a guess. */
export type DayRateInfo = { coveredHours: number; derivable: boolean };

/** Key: `${jobId}|${workDate}|${specialtyId}`. */
export type DayRateMap = Map<string, DayRateInfo>;

export function dayRateKey(
  jobId: string | null | undefined,
  workDate: string | null | undefined,
  specialtyId: string | null | undefined,
): string {
  return `${jobId ?? "__"}|${workDate ?? "__"}|${specialtyId ?? "__"}`;
}

/** The quote payroll should follow for a job: the latest issued,
 *  non-superseded quote — what was actually sold. An open draft revision
 *  is deliberately NOT preferred; payroll pays against the agreed quote,
 *  not a work in progress. Falls back to a draft only when the job has
 *  never issued one. */
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
  const issued = rows.find((r) => !r.is_draft && r.status !== "superseded");
  if (issued) return issued.id;
  return rows.find((r) => r.is_draft)?.id ?? null;
}

/** Build the day-rate lookup for a set of jobs.
 *
 *  Reuses `loadQuoteRateHints` — the SAME lookup the invoice/pre-invoice
 *  pricing path uses — so payroll cannot disagree with billing about which
 *  (date, specialty) combinations are day rate.
 *
 *  Jobs with no quote, or quotes with no day-rate lines, simply contribute
 *  nothing to the map; those rows stay hourly.
 */
export async function loadDayRateMapForJobs(jobIds: (string | null | undefined)[]): Promise<DayRateMap> {
  const out: DayRateMap = new Map();
  const unique = Array.from(new Set(jobIds.filter((j): j is string => !!j)));
  if (unique.length === 0) return out;

  await Promise.all(unique.map(async (jobId) => {
    try {
      const quoteId = await resolvePayrollQuoteIdForJob(jobId);
      if (!quoteId) return;
      const hints = await loadQuoteRateHints(quoteId);
      hints.forEach((hint, key) => {
        if (hint.rateMode !== "day") return;
        // key is `${quote_date}|${specialty_id}`
        const [quoteDate, specialtyId] = key.split("|");
        out.set(dayRateKey(jobId, quoteDate, specialtyId), {
          coveredHours: dayRateCoveredHours(hint.baseDay, hint.baseHourly),
          derivable: isDayRateHoursDerivable(hint.baseDay, hint.baseHourly),
        });
      });
    } catch (e) {
      console.warn("[payroll-day-rate] day-rate lookup failed for job", jobId, e);
    }
  }));

  return out;
}
