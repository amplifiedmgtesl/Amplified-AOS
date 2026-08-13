// ⚠ SYNCED COPY: durationMinutes (and its helpers) are mirrored in the staff app
// at amplified-staff/lib/calc/time-utils.ts. Mirror any change there.
// See amplified-staff/docs/v2-alignment-plan.md.
//
// Shared time helpers used across timekeeping, quote builder, and invoice builder.
//
// The app is single-timezone; all dates/times are local wall-clock. Real date+time
// duration is used when both start and end dates are supplied (handles shifts
// that cross midnight or span multiple days naturally). When dates are missing
// (legacy rows), falls back to the same-day +24h trick: if end < start, assume
// it rolled over once.

export function parseMinutes(value: string): number | null {
  if (!value) return null;
  const t = value.trim().toUpperCase();
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mins = Number(m[2]);
  const mer = m[3];
  if (Number.isNaN(h) || Number.isNaN(mins)) return null;
  if (mer === "AM" && h === 12) h = 0;
  else if (mer === "PM" && h !== 12) h += 12;
  return h * 60 + mins;
}

/**
 * The app's one DISPLAY formatter for a stored clock time: "08:00" → "8:00 AM".
 *
 * Storage stays 24h "HH:MM" everywhere — that is deliberate and documented in
 * the 20260708a/20260708c migration comments. Display is 12h AM/PM because a
 * native <input type="time"> renders in the OS locale and cannot be forced to
 * 24h, so it is the fixed point every other surface has to agree with.
 * Before this existed, the same screen showed a day window as "08:00–13:00"
 * and the per-worker planned inputs beside it as "7:00 AM".
 *
 * Accepts either notation (parseMinutes handles both) so it is safe to apply
 * to a value of unknown provenance. Blank in, blank out.
 *
 * ⚠ UNPARSEABLE INPUT IS PASSED THROUGH UNCHANGED, not swallowed. These are
 * text columns, and production has 87 values in them that are not clock times
 * at all: `calendar_events` carries "TBD" (49 rows), "tbd" (9), "9am-6pm",
 * "5-8pm", "6:00p", "out by 1:00am"; two `job_request_days` fields hold a DATE
 * ("8/10/2026") that someone typed into a time box. An earlier version of this
 * returned "" for all of them, which would have silently blanked every one of
 * those on screen the moment these formatters were adopted — deleting a messy
 * but meaningful "TBD" from the calendar, and hiding the date-in-a-time-field
 * typo instead of leaving it visible to be fixed. Showing a human what they
 * actually typed always beats showing them nothing.
 * (Timesheet times are clean — 0 of 5,312 prod values fail to parse — so the
 * timekeeping grid was never exposed to this. The display surfaces were.)
 */
export function formatClock(value: string | null | undefined): string {
  const raw = value ?? "";
  const mins = parseMinutes(raw);
  if (mins == null) return raw.trim();
  const h24 = Math.floor(mins / 60) % 24;
  const mm = String(mins % 60).padStart(2, "0");
  const mer = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${mer}`;
}

/**
 * A time RANGE for display: "08:00", "13:00" → "8:00 AM – 1:00 PM".
 * Either side may be blank; `missing` fills the gap so a half-set window still
 * reads honestly. Returns "" when both sides are empty.
 *
 * Inherits formatClock's pass-through, so a day whose start_time holds junk
 * still shows it rather than going blank — prod has two day rows carrying a
 * date in the time field, and those render as "8/10/2026 – 8/5/2026", which is
 * ugly, correct, and fixable precisely because it is visible.
 */
export function formatClockRange(
  start: string | null | undefined,
  end: string | null | undefined,
  missing = "?",
): string {
  const a = formatClock(start);
  const b = formatClock(end);
  if (!a && !b) return "";
  return `${a || missing} – ${b || missing}`;
}

function toMoment(date: string, timeText: string): number {
  const m = parseMinutes(timeText);
  if (!date || m == null) return NaN;
  // Local Date interpretation — single-TZ app, ignore timezone.
  return new Date(date + "T00:00:00").getTime() + m * 60_000;
}

/**
 * Duration in minutes between a start (date + time) and end (date + time).
 * When both dates are supplied, does real calendar math. Falls back to the
 * same-day +24h trick when dates are missing (legacy code paths).
 * Returns 0 if inputs are invalid or end < start.
 */
export function durationMinutes(
  startDate: string | undefined,
  startTime: string,
  endDate: string | undefined,
  endTime: string,
): number {
  if (startDate && endDate) {
    const s = toMoment(startDate, startTime);
    const e = toMoment(endDate, endTime);
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
    return Math.round((e - s) / 60_000);
  }
  const s = parseMinutes(startTime);
  const e = parseMinutes(endTime);
  if (s == null || e == null) return 0;
  let diff = e - s;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

/** Back-compat wrapper. Hours as decimal (2 places). Uses same-day +24h trick. */
export function hoursBetween(startTime: string, endTime: string): number {
  return Number((durationMinutes(undefined, startTime, undefined, endTime) / 60).toFixed(2));
}

/**
 * Returns `ymd` advanced by one calendar day. Input "YYYY-MM-DD", output same.
 */
export function advanceDay(ymd: string): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Given the timesheet entry's anchor dates + all four text times, compute the
 * implicit per-pair dates. Pair 1 out advances if it crosses midnight (text
 * comparison). Pair 2 is assumed to start on pair 1's out date and may also
 * cross midnight.
 */
export function inferPairDates(
  workDate: string,
  timeIn1: string,
  timeOut1: string,
  timeIn2: string,
  timeOut2: string,
): { in1Date: string; out1Date: string; in2Date: string; out2Date: string } {
  const in1Date = workDate;
  const in1 = parseMinutes(timeIn1);
  const out1 = parseMinutes(timeOut1);
  const pair1Crosses = in1 != null && out1 != null && out1 < in1;
  const out1Date = pair1Crosses ? advanceDay(workDate) : workDate;

  const in2Date = out1Date;
  const in2 = parseMinutes(timeIn2);
  const out2 = parseMinutes(timeOut2);
  const pair2Crosses = in2 != null && out2 != null && out2 < in2;
  const out2Date = pair2Crosses ? advanceDay(in2Date) : in2Date;

  return { in1Date, out1Date, in2Date, out2Date };
}
