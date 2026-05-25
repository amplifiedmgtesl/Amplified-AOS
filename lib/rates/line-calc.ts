/**
 * Shared line-total calculation, used by quote-draft-editor, invoice-draft-
 * editor, and any future line-aware screen.
 *
 * As of 2026-05-12 the line shape carries explicit ST/OT/DT person-hours
 * plus crew_count. The rule string is informational only — no longer
 * parsed at calc time. This decouples per-worker OT splits (decided at
 * import/entry time) from the runtime total formula.
 *
 * As of 2026-05-25 (Holiday cleanup) holiday treatment is purely day-level,
 * sourced from quote_days / invoice_days. When the parent day is flagged
 * holiday, EVERY hour billable on the line bills at 2× base rate — the
 * holiday flat rate supersedes any OT/DT premium structure (Connor:
 * "everything at holiday rate, period"). OT and DT hours stay in their
 * own buckets on screen (so operator can read across without moving data)
 * but bill at base × 2 just like ST hours.
 *
 * FORMULA
 *
 *   Non-holiday day mode:
 *     total = crewCount × baseDay
 *           + otHours × otRate
 *           + dtHours × dtRate
 *           + travel
 *
 *   Non-holiday hourly mode:
 *     total = hours × baseHourly
 *           + otHours × otRate
 *           + dtHours × dtRate
 *           + travel
 *
 *   Holiday day mode:
 *     total = H × (crewCount × baseDay)
 *           + H × (otHours + dtHours) × baseHourly
 *           + travel
 *
 *   Holiday hourly mode:
 *     total = H × (hours + otHours + dtHours) × baseHourly
 *           + travel
 *
 *   Where H = HOLIDAY_MULTIPLIER (= 2.0).
 *
 *   Key holiday rule: OT/DT hours bill at `baseHourly × H` (not `otRate × H`
 *   or `dtRate × H`) — the holiday flat rate supersedes the OT/DT premium.
 *   This way 10 ST + 2 OT + 3 DT on a holiday all bill at the same hourly
 *   rate, customer pays for 15 hours × base × 2.
 *
 * SEMANTICS
 *
 *   - crewCount = explicit worker count. Multiplier on day-rate base ONLY;
 *     informational on hourly lines (hours is already total person-hours).
 *   - hours = total ST person-hours. 0 on day-rate lines (day rate covers ST).
 *   - otHours / dtHours = total person-hours billed at OT/DT rates on
 *     non-holiday days; at base × 2 on holiday days.
 *   - travel = flat per line, regardless of crew count or holiday status.
 *
 *   Mode detection: rateMode='day' OR (baseDay>0 AND hours=0 AND rateMode!='hourly').
 *   The hours==0 check is what makes the migration backfill self-consistent:
 *   day-mode lines have hours=0, hourly lines have hours=total.
 */

import type { QuoteLine } from "@/lib/store/types";

/** 2.0× — the default holiday multiplier. As of 2026-05-25 the actual
 *  value lives on the rate card (rate_card_profiles.holiday_multiplier),
 *  snapshotted onto each quote and invoice at draft creation. The constant
 *  is the fallback used by callers that haven't been wired to pass the
 *  per-document value yet. */
export const HOLIDAY_MULTIPLIER = 2.0;

export function isDayModeLine(l: Pick<QuoteLine, "rateMode" | "baseDay" | "hours">): boolean {
  if (l.rateMode === "day") return true;
  if (l.rateMode === "hourly") return false;
  // Legacy lines without explicit rateMode — infer from data shape.
  return (l.baseDay || 0) > 0 && (l.hours || 0) === 0;
}

export function computeLineTotal(
  l: Pick<QuoteLine,
    "rateMode" | "crewCount" | "qty" | "hours" | "otHours" | "dtHours"
    | "travel" | "baseHourly" | "baseDay" | "otRate" | "dtRate"
  >,
  opts: { dayIsHoliday?: boolean; holidayMultiplier?: number } = {},
): number {
  const crewCount    = Number(l.crewCount ?? l.qty ?? 1);
  const hours        = Number(l.hours        || 0);
  const otHours      = Number(l.otHours      || 0);
  const dtHours      = Number(l.dtHours      || 0);
  const travel       = Number(l.travel       || 0);
  const baseHourly   = Number(l.baseHourly   || 0);
  const baseDay      = Number(l.baseDay      || 0);
  const otRate       = Number(l.otRate       || 0);
  const dtRate       = Number(l.dtRate       || 0);

  const base = isDayModeLine(l)
    ? crewCount * baseDay
    : hours     * baseHourly;

  if (opts.dayIsHoliday) {
    // Holiday rule: every billable hour at base × H. OT/DT stay in their
    // own buckets on screen but bill at baseHourly (not otRate/dtRate),
    // so 10 ST + 2 OT + 3 DT on a holiday = 15 hrs × baseHourly × H.
    // Day-mode lines: day rate × H covers the day, plus any overflow
    // OT/DT hours at baseHourly × H. H is per-document (snapshotted from
    // the rate card at creation); falls back to HOLIDAY_MULTIPLIER for
    // callers that haven't passed it yet.
    const H = opts.holidayMultiplier ?? HOLIDAY_MULTIPLIER;
    const extraHoursAtBase = (otHours + dtHours) * baseHourly;
    return Math.round((H * (base + extraHoursAtBase) + travel) * 100) / 100;
  }

  const total = base
    + otHours * otRate
    + dtHours * dtRate
    + travel;

  return Math.round(total * 100) / 100;
}
