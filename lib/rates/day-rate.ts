/** Day-rate ("flat rate") shared helpers.
 *
 *  A day rate is a flat fee covering a fixed block of hours. On the BILL
 *  side the block is charged as one line and hours past it overflow at the
 *  hourly rate. On the PAY side the block IS the hours paid — crew on a
 *  day-rate job check in and stay on call across the whole span, used
 *  sporadically rather than worked continuously, which is precisely why
 *  the job is priced this way. Clock time is therefore the wrong input.
 *
 *  Both sides derive the block size from THIS function so bill and pay
 *  cannot drift. "How I charge is how I pay" (Connor, 2026-08-30) is
 *  structural, not coincidental.
 *
 *  TODO (backlog 2026-08-30): the covered-hours figure should become a
 *  stored numeric field on quote_lines (defaulted from the rate card)
 *  rather than being derived. Deferred because quoting and invoicing
 *  would both need to read it, which is a much bigger change than the
 *  payroll fix this shipped with. When that lands, this becomes
 *  `coalesce(storedHours, dayRateCoveredHours(...))`.
 */

/** Fallback block size when the covered hours cannot be derived, i.e. the
 *  quote line carries a day rate but no hourly to divide by. A guess — see
 *  `dayRateCoveredHours` for why that is worth knowing about. */
export const DAY_RATE_FALLBACK_HOURS = 10;

/** How many hours a day rate covers, derived from the day/hourly ratio on
 *  the quote line.
 *
 *    $330 day / $33 hourly = 10 hrs   (full day)
 *    $165 day / $33 hourly =  5 hrs   (half day)
 *    $350 day / $35 hourly = 10 hrs
 *
 *  Half days need no special case — a half-day line simply derives a
 *  smaller block. The same holds for any block Connor chooses to sell
 *  (8 hrs, 6 hrs); it is just a different ratio.
 *
 *  ⚠ Returns DAY_RATE_FALLBACK_HOURS when no usable hourly is available.
 *  That is an invented number, not something anyone entered — callers that
 *  pay people should surface it rather than swallow it. Use
 *  `isDayRateHoursDerivable` to detect the case up front.
 */
export function dayRateCoveredHours(baseDay: number, baseHourly: number): number {
  if (!(baseHourly > 0) || !(baseDay > 0)) return DAY_RATE_FALLBACK_HOURS;
  const hours = Math.round(baseDay / baseHourly);
  // A ratio that rounds to zero (day rate smaller than one hour) is
  // meaningless as a block; treat it as underivable rather than paying 0.
  return hours > 0 ? hours : DAY_RATE_FALLBACK_HOURS;
}

/** True when the covered hours come from real numbers rather than the
 *  fallback. Lets pay-side callers flag rows that are running on a guess. */
export function isDayRateHoursDerivable(baseDay: number, baseHourly: number): boolean {
  return baseDay > 0 && baseHourly > 0 && Math.round(baseDay / baseHourly) > 0;
}
