/**
 * Shared line-total calculation, used by quote-draft-editor, invoice-draft-
 * editor, and any future line-aware screen.
 *
 * As of 2026-05-12 the line shape carries explicit ST/OT/DT/holiday person-
 * hours plus crew_count. The rule string is informational only — no longer
 * parsed at calc time. This decouples per-worker OT splits (decided at
 * import/entry time) from the runtime total formula.
 *
 * As of 2026-05-24 (Holiday Phase 2) the formula optionally honors a
 * day-level `is_holiday` flag (sourced from quote_days / invoice_days):
 * when true, the work portion (base + OT + DT) gets HOLIDAY_MULTIPLIER
 * (= 2.0×) applied. The per-line `holidayHours` field still adds at
 * dtRate without an additional multiplier (it semantically represents
 * "already-holiday-rate hours" — keeping it un-multiplied avoids
 * double-counting). Travel is always pass-through.
 *
 * FORMULA (with H = HOLIDAY_MULTIPLIER when dayIsHoliday else 1)
 *
 *   Day mode:
 *     total = H × (crewCount × baseDay)
 *           + H × otHours × otRate
 *           + H × dtHours × dtRate
 *           +     holidayHours × dtRate
 *           +     travel
 *
 *   Hourly mode:
 *     total = H × (hours × baseHourly)
 *           + H × otHours × otRate
 *           + H × dtHours × dtRate
 *           +     holidayHours × dtRate
 *           +     travel
 *
 * SEMANTICS
 *
 *   - crewCount = explicit worker count. Multiplier on day-rate base ONLY;
 *     informational on hourly lines (hours is already total person-hours).
 *   - hours = total ST person-hours. 0 on day-rate lines (day rate covers ST).
 *   - otHours / dtHours / holidayHours = total person-hours billed at their
 *     respective rates.
 *   - travel = flat per line, regardless of crew count or holiday status.
 *
 *   Mode detection: rateMode='day' OR (baseDay>0 AND hours=0 AND rateMode!='hourly').
 *   The hours==0 check is what makes the migration backfill self-consistent:
 *   day-mode lines have hours=0, hourly lines have hours=total.
 */

import type { QuoteLine } from "@/lib/store/types";

/** 2.0× — the holiday multiplier applied to base/OT/DT work when the
 *  parent day is flagged as a holiday. Hardcoded for now (per the
 *  2026-05-24 design decision); migrate to a settings table if real
 *  variation emerges. */
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
    | "holidayHours" | "travel" | "baseHourly" | "baseDay" | "otRate" | "dtRate"
  >,
  opts: { dayIsHoliday?: boolean } = {},
): number {
  const crewCount    = Number(l.crewCount ?? l.qty ?? 1);
  const hours        = Number(l.hours        || 0);
  const otHours      = Number(l.otHours      || 0);
  const dtHours      = Number(l.dtHours      || 0);
  const holidayHours = Number(l.holidayHours || 0);
  const travel       = Number(l.travel       || 0);
  const baseHourly   = Number(l.baseHourly   || 0);
  const baseDay      = Number(l.baseDay      || 0);
  const otRate       = Number(l.otRate       || 0);
  const dtRate       = Number(l.dtRate       || 0);

  const H = opts.dayIsHoliday ? HOLIDAY_MULTIPLIER : 1;

  const base = isDayModeLine(l)
    ? crewCount * baseDay
    : hours     * baseHourly;

  const total = H * base
    + H * otHours      * otRate
    + H * dtHours      * dtRate
    +     holidayHours * dtRate
    +     travel;

  return Math.round(total * 100) / 100;
}
