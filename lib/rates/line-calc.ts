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
 * holiday, ALL work bills at 2× base — OT/DT distinctions don't apply
 * (Connor: "everything at holiday rate, period"). The per-line
 * `holiday_hours` column was dropped as redundant.
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
 *     total = HOLIDAY_MULTIPLIER × crewCount × baseDay  +  travel
 *
 *   Holiday hourly mode:
 *     total = HOLIDAY_MULTIPLIER × hours × baseHourly   +  travel
 *
 *   OT/DT terms vanish entirely on holiday days (operator can't enter them
 *   — the editor disables those inputs and auto-zeros otHours / dtHours
 *   whenever the day flag is on).
 *
 * SEMANTICS
 *
 *   - crewCount = explicit worker count. Multiplier on day-rate base ONLY;
 *     informational on hourly lines (hours is already total person-hours).
 *   - hours = total ST person-hours. 0 on day-rate lines (day rate covers ST).
 *   - otHours / dtHours = total person-hours billed at OT/DT rates (only
 *     applicable to non-holiday days).
 *   - travel = flat per line, regardless of crew count or holiday status.
 *
 *   Mode detection: rateMode='day' OR (baseDay>0 AND hours=0 AND rateMode!='hourly').
 *   The hours==0 check is what makes the migration backfill self-consistent:
 *   day-mode lines have hours=0, hourly lines have hours=total.
 */

import type { QuoteLine } from "@/lib/store/types";

/** 2.0× — the holiday multiplier applied to base hours when the parent
 *  day is flagged as a holiday. Hardcoded for now (per the 2026-05-24
 *  design decision); migrate to a settings table if real variation emerges. */
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
  opts: { dayIsHoliday?: boolean } = {},
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
    // Holiday rule: flat 2× base, OT/DT do NOT stack. Travel pass-through.
    return Math.round((HOLIDAY_MULTIPLIER * base + travel) * 100) / 100;
  }

  const total = base
    + otHours * otRate
    + dtHours * dtRate
    + travel;

  return Math.round(total * 100) / 100;
}
