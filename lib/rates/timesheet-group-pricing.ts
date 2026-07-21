/**
 * Shared pricing for timesheet-entry groups → invoice-style lines.
 *
 * Extracted from overwriteFromTimesheets (lib/store/invoices.ts) 2026-07-21 so
 * the pre-invoice client report prices lines with the SAME engine as the real
 * invoice pull — rate card bill rates + the source quote's day-vs-hourly rate
 * hints. Any change to pricing behavior belongs here, not in a caller.
 *
 * Callers:
 *   - overwriteFromTimesheets (invoice pull) — groups by the canonical 5-tuple
 *     (date, position, specialty, shift, holiday)
 *   - buildPreInvoiceReport (lib/reports/pre-invoice-report.ts) — same 5-tuple
 *     PLUS the time signature (in/out pairs + meal breaks), so each invoice
 *     line splits into per-time-block sub-lines
 */

import { supabase } from "@/lib/supabase/client";
import type { QuoteLine } from "@/lib/store/types";
import { computeLineTotal } from "@/lib/rates/line-calc";

/** The operator's billing-structure intent per (date, specialty), read from
 *  the source quote's lines. Build days quoted at day-rate produce day-mode
 *  lines automatically; show days quoted hourly stay hourly. */
export type QuoteRateHint = { rateMode: "day" | "hourly"; baseDay: number; baseHourly: number };

/** Bill-side rates from the resolved rate card, keyed by specialty_id. */
export type BillRate = { hourly: number; otRate: number; dtRate: number };

/** One group of timesheet entries to be priced as a single line. Hours are
 *  summed person-hours across the group; workerTotalHours is per-worker
 *  total_hours (drives the day-mode floor/overflow math). */
export type TimesheetGroupAgg = {
  workDate: string;
  endDate: string | null;
  positionId: string | null;
  positionText: string;
  specialtyId: string | null;
  shiftId: string | null;
  isHoliday: boolean;
  stdHours: number;
  otHours: number;
  dtHours: number;
  crewCount: number;
  workerTotalHours: Map<string, number>;
};

/** Load the quote's rate-mode hints, keyed `${quote_date}|${specialty_id}`.
 *
 *  Keyed on (date, specialty) — quote_lines.position_id was dropped in
 *  migration 20260505b, and specialty already implies position. Tiebreaker:
 *  if the quote has BOTH day and hourly lines for the same (date, specialty)
 *  — common when bulk crew is on day rate plus extra-hour add-ons — prefer
 *  DAY mode. Day-rate covers the standard hours; overflow past the floor
 *  falls into the OT bucket at the (unchanged) hourly rate, no premium.
 *
 *  Returns an empty map (and console.warn) on read failure — callers build
 *  hourly-mode lines in that case, matching the historical behavior. */
export async function loadQuoteRateHints(quoteId: string): Promise<Map<string, QuoteRateHint>> {
  const hints = new Map<string, QuoteRateHint>();
  const qlRes = await supabase
    .from("quote_lines")
    .select("quote_date, specialty_id, rate_mode, base_day, base_hourly")
    .eq("quote_id", quoteId);
  if (qlRes.error) {
    console.warn("[timesheet-group-pricing] could not load source quote lines:", qlRes.error.message);
    return hints;
  }
  for (const ql of (qlRes.data ?? []) as any[]) {
    if (!ql.quote_date || !ql.specialty_id) continue;
    const key = `${ql.quote_date}|${ql.specialty_id}`;
    const isDay = ql.rate_mode === "day";
    const existing = hints.get(key);
    // First hit wins UNLESS this row is day-mode and the prior wasn't.
    if (!existing || (isDay && existing.rateMode !== "day")) {
      hints.set(key, {
        rateMode: isDay ? "day" : "hourly",
        baseDay: Number(ql.base_day ?? 0),
        baseHourly: Number(ql.base_hourly ?? 0),
      });
    }
  }
  return hints;
}

/** Bill rates keyed by specialty_id from resolved rate-card rows. */
export function buildBillRateMap(rateCardRows: any[]): Map<string, BillRate> {
  const m = new Map<string, BillRate>();
  for (const row of (rateCardRows ?? []) as any[]) {
    if (!row.specialty_id) continue;
    m.set(row.specialty_id, {
      hourly: Number(row.hourly ?? 0),
      otRate: Number(row.ot_rate ?? 0),
      dtRate: Number(row.dt_rate ?? 0),
    });
  }
  return m;
}

/** Price one entry group as an invoice-style line.
 *
 *  Bill rates come from the rate card; groups whose specialty has no
 *  rate-card row land with $0 rates and missingRate=true — the caller
 *  decides how to surface that. This is the intentional "pay vs. bill"
 *  separation: timesheets supply hours/crew/dates only, never rates.
 *
 *  Quote-aware rate mode: if the hint for (date, specialty) is day mode,
 *  build a day-mode line. The day-rate floor per worker is derived as
 *  round(base_day / base_hourly) — for Connor's CCMF rate card every
 *  position is exactly 10 (350/35, 380/38, 500/50, etc.). Overflow past
 *  that floor per worker bills into the OT bucket at base_hourly (no
 *  premium — matches contracts like "day rate covers 10hrs, hourly
 *  thereafter"). */
export function priceTimesheetGroup(
  g: TimesheetGroupAgg,
  opts: {
    rate: BillRate | undefined;
    hint: QuoteRateHint | undefined;
    holidayMultiplier?: number;
  },
): { line: QuoteLine; missingRate: boolean } {
  const { rate, hint } = opts;
  const missingRate = !rate;
  const baseHourly = rate?.hourly ?? 0;
  const otRate     = rate?.otRate ?? 0;
  const dtRate     = rate?.dtRate ?? 0;

  const useDayMode = hint?.rateMode === "day" && hint.baseDay > 0;
  let lineHours = +g.stdHours.toFixed(2);
  let lineOtHours = +g.otHours.toFixed(2);
  let lineDtHours = +g.dtHours.toFixed(2);
  let lineBaseDay = 0;
  let lineBaseHourly = baseHourly;
  let lineOtRate = otRate;
  let lineRateMode: "day" | "hourly" = "hourly";
  let lineRule = g.isHoliday ? "Holiday timesheet actuals" : "Timesheet actuals";

  if (useDayMode) {
    const baseDay = hint!.baseDay;
    const hourlyForOverflow = hint!.baseHourly > 0 ? hint!.baseHourly : baseHourly;
    // Floor = how many hours the day rate "covers" per worker.
    // Derived from quote's day/hourly ratio. For CCMF: 350/35 = 10.
    const floor = hourlyForOverflow > 0
      ? Math.round(baseDay / hourlyForOverflow)
      : 10;
    // Per-worker overflow = hours past the floor, summed across workers.
    let overflow = 0;
    g.workerTotalHours.forEach((hrs) => {
      if (hrs > floor) overflow += (hrs - floor);
    });
    lineRateMode = "day";
    lineBaseDay = baseDay;
    lineBaseHourly = hourlyForOverflow;
    lineHours = 0;                              // day mode: hours field unused
    lineOtHours = +overflow.toFixed(2);         // overflow bills at hourly
    lineOtRate = hourlyForOverflow;             // no premium
    lineDtHours = 0;
    lineRule = g.isHoliday
      ? `Holiday day rate (floor ${floor}hr) + hourly overflow`
      : `Day rate (floor ${floor}hr) + hourly overflow per quote`;
  }

  const line: QuoteLine = {
    serviceKey: g.positionText,
    qty: g.crewCount,
    crewCount: g.crewCount,
    hours:        lineHours,
    otHours:      lineOtHours,
    dtHours:      lineDtHours,
    travel:       0,
    baseHourly:   lineBaseHourly,
    baseDay:      lineBaseDay,
    otRate:       lineOtRate,
    dtRate,
    rule:         lineRule,
    total:        0,
    positionId:   g.positionId ?? undefined,
    specialtyId:  g.specialtyId ?? undefined,
    specialty:    g.positionText,  // legacy display fallback
    shiftId:      g.shiftId ?? undefined,
    quoteDate:    g.workDate,
    endDate:      g.endDate ?? undefined,
    rateMode:     lineRateMode,
    sourceKind:   "timesheet_entry",
  };
  line.total = +computeLineTotal(line, {
    dayIsHoliday: g.isHoliday,
    holidayMultiplier: opts.holidayMultiplier,
  }).toFixed(2);
  return { line, missingRate };
}
