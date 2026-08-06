/**
 * lib/rates/day-floor.ts
 *
 * The day-rate "floor": how many hours a day rate covers per worker before
 * hours spill into hourly overflow.
 *
 * The floor is NOT stored anywhere. It is derived from the rate card's
 * day/hourly ratio. For rate cards where those divide evenly (350/35,
 * 380/38, 500/50 → 10) the derived value is exactly what the contract says.
 * Where they don't, the floor is a rounded number nobody explicitly chose.
 *
 * Storing it as a real field is backlog #36 option A. Until then this module
 * is the single definition, so the pricing path, the job-health check and the
 * rate-card editor can't drift apart — and there is one place to change when
 * option A lands.
 */

/** Fallback when no hourly rate is available to divide by. Matches the
 *  historical inline default and the editor's `day = hourly × 10` seeding. */
export const DEFAULT_DAY_FLOOR_HOURS = 10;

/** Hours the day rate covers per worker. Exactly the arithmetic that was
 *  inline in priceTimesheetGroup — do not "improve" the rounding here
 *  without deciding #36, because it moves real invoice totals. */
export function deriveDayFloor(baseDay: number, baseHourly: number): number {
  const day = Number(baseDay) || 0;
  const hourly = Number(baseHourly) || 0;
  if (hourly <= 0) return DEFAULT_DAY_FLOOR_HOURS;
  return Math.round(day / hourly);
}

/** True when day/hourly divides evenly, i.e. the derived floor is the real
 *  break-even rather than a rounded approximation of it. Rows that aren't
 *  day-rate rows (either value missing) count as exact — there is no floor
 *  to be wrong about. */
export function dayFloorIsExact(baseDay: number, baseHourly: number): boolean {
  const day = Number(baseDay) || 0;
  const hourly = Number(baseHourly) || 0;
  if (day <= 0 || hourly <= 0) return true;
  const ratio = day / hourly;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

/** The day rate that WOULD make the derived floor exact, keeping the hourly
 *  rate fixed. Used to suggest a correction in warnings. */
export function suggestedDayRate(baseDay: number, baseHourly: number): number {
  const hourly = Number(baseHourly) || 0;
  if (hourly <= 0) return 0;
  return Math.round(deriveDayFloor(baseDay, hourly) * hourly * 100) / 100;
}
