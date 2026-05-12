/**
 * Shared line-total calculation, used by quote-draft-editor, invoice-draft-
 * editor, and any future line-aware screen.
 *
 * As of 2026-05-12 the line shape carries explicit ST/OT/DT/holiday person-
 * hours plus crew_count. The rule string is informational only — no longer
 * parsed at calc time. This decouples per-worker OT splits (decided at
 * import/entry time) from the runtime total formula.
 *
 * FORMULA
 *
 *   Day mode:
 *     total = crewCount × baseDay
 *           + otHours × otRate
 *           + dtHours × dtRate
 *           + holidayHours × dtRate
 *           + travel
 *
 *   Hourly mode:
 *     total = hours × baseHourly
 *           + otHours × otRate
 *           + dtHours × dtRate
 *           + holidayHours × dtRate
 *           + travel
 *
 *   The only difference is the base term. Everything else stacks on top.
 *
 * SEMANTICS
 *
 *   - crewCount = explicit worker count. Multiplier on day-rate base ONLY;
 *     informational on hourly lines (hours is already total person-hours).
 *   - hours = total ST person-hours. 0 on day-rate lines (day rate covers ST).
 *   - otHours / dtHours / holidayHours = total person-hours billed at their
 *     respective rates.
 *   - travel = flat per line, regardless of crew count.
 *
 *   Mode detection: rateMode='day' OR (baseDay>0 AND hours=0 AND rateMode!='hourly').
 *   The hours==0 check is what makes the migration backfill self-consistent:
 *   day-mode lines have hours=0, hourly lines have hours=total.
 */

import type { QuoteLine } from "@/lib/store/types";

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
  >
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

  const base = isDayModeLine(l)
    ? crewCount * baseDay
    : hours     * baseHourly;

  const total = base
    + otHours      * otRate
    + dtHours      * dtRate
    + holidayHours * dtRate
    + travel;

  return Math.round(total * 100) / 100;
}
