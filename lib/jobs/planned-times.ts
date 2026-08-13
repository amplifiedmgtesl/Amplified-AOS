// Resolving a crew member's PLANNED (scheduled) times — the "planned" side of
// the Planned-vs-Actual model.
//
// One rule, in one place, because four surfaces have to agree on it: the
// printed crew sign-in sheet's Expected column, the Time Clock kiosk's
// expected-time display, "Copy planned → actual" on the timekeeping grid, and
// the pre-flight that warns before printing a sheet with a blank Expected.
// If they disagree, a worker signs against one schedule while the office bills
// from another.
//
// ⚠ Honest record, since the commit that created this file overstated the case:
// the surfaces had NOT actually diverged in any reachable way. Copy planned →
// actual used `??` where the others used `||`, which differs only on an empty
// string — and assignmentToRow() is the single writer of these columns and
// coerces every one with `|| null`, so an empty string cannot be stored. The
// real justification is forward-looking and has already paid off twice: the
// kiosk arrived after this extraction and needed exactly this rule (it would
// otherwise have been a fourth hand-written copy), and dayWindowContains below
// fixed a genuine midnight bug from here rather than inline in one screen.
//
// The rule: each PAIR falls back independently to the matching day block —
// pair 1 → day.startTime/endTime, pair 2 → day.startTime2/endTime2. A worker
// with no planned times of their own rides the day window entirely; a worker
// with an override on pair 1 only still rides the day window for pair 2.
//
// Note there is no invented default anywhere in here: when neither the
// assignment nor the day supplies a time, the answer is "unknown", and callers
// must render that honestly rather than substituting something plausible.
// That is the #39 failure (a placeholder that Safari drew as a real time)
// expressed as a data rule.

import type { JobRequestAssignment, JobRequestDay } from "@/lib/store/types";
import { formatClockRange, parseMinutes } from "@/lib/time-utils";

/** One resolved time pair. Either side may be absent when nothing answers. */
export type PlannedPair = {
  in?: string;
  out?: string;
};

export type PlannedTimes = {
  pair1: PlannedPair;
  pair2: PlannedPair;
  /** True when neither pair resolved to anything at all. */
  isEmpty: boolean;
};

function resolvePair(
  ovIn: string | undefined,
  ovOut: string | undefined,
  dayIn: string | undefined,
  dayOut: string | undefined,
): PlannedPair {
  // Each SIDE falls back independently, so a worker who overrides only their
  // start time still finishes at the day's end time.
  //
  // `|| undefined` normalizes an empty string to absent. Every consumer today
  // treats "" and undefined the same (both falsy, both format to ""), but
  // "unset" should have ONE representation coming out of here rather than two
  // that happen to behave alike.
  return { in: ovIn || dayIn || undefined, out: ovOut || dayOut || undefined };
}

/** True when this pair resolved to nothing at all. */
function pairIsEmpty(p: PlannedPair): boolean {
  return !p.in && !p.out;
}

/** Resolve both planned pairs for one assignment on its day. */
export function resolvePlannedTimes(
  a: Pick<JobRequestAssignment, "plannedIn1" | "plannedOut1" | "plannedIn2" | "plannedOut2">,
  day: Pick<JobRequestDay, "startTime" | "endTime" | "startTime2" | "endTime2"> | null | undefined,
): PlannedTimes {
  const pair1 = resolvePair(a.plannedIn1, a.plannedOut1, day?.startTime, day?.endTime);
  const pair2 = resolvePair(a.plannedIn2, a.plannedOut2, day?.startTime2, day?.endTime2);
  return { pair1, pair2, isEmpty: pairIsEmpty(pair1) && pairIsEmpty(pair2) };
}

/**
 * Display text for both pairs: "8:00 AM – 1:00 PM · 2:00 PM – 7:00 PM".
 * Returns "" when nothing resolves — callers decide what a blank means in
 * their context (the sheet prints an empty cell; the kiosk says so out loud).
 */
export function formatPlannedTimes(
  a: Pick<JobRequestAssignment, "plannedIn1" | "plannedOut1" | "plannedIn2" | "plannedOut2">,
  day: Pick<JobRequestDay, "startTime" | "endTime" | "startTime2" | "endTime2"> | null | undefined,
): string {
  const { pair1, pair2 } = resolvePlannedTimes(a, day);
  return [
    formatClockRange(pair1.in, pair1.out),
    formatClockRange(pair2.in, pair2.out),
  ].filter(Boolean).join(" · ");
}

/**
 * Does a day's scheduled window still contain `now`, counting blocks that run
 * past midnight?
 *
 * A day row's times are wall-clock strings anchored to its event_date, so a
 * block like 20:00–02:00 on Aug 12 actually ends at 02:00 on Aug 13. Comparing
 * "is it between start and end" without accounting for that answers no for the
 * entire second half of the block — the half where people are still working.
 *
 * `graceMinutes` extends each block at both ends: shifts start late and run
 * long, and someone signing out 20 minutes after the scheduled end still
 * belongs to that day. Generous by design — the alternative is telling a
 * worker at 02:15 that their shift isn't happening.
 */
export function dayWindowContains(
  day: Pick<JobRequestDay, "eventDate" | "startTime" | "endTime" | "startTime2" | "endTime2">,
  now: Date,
  graceMinutes = 120,
): boolean {
  if (!day.eventDate) return false;
  const anchor = new Date(day.eventDate + "T00:00:00").getTime();
  if (Number.isNaN(anchor)) return false;
  const t = now.getTime();

  const check = (start?: string, end?: string): boolean => {
    const s = parseMinutes(start ?? "");
    let e = parseMinutes(end ?? "");
    if (s == null || e == null) return false;
    if (e <= s) e += 1440;          // block runs past midnight onto the next date
    const from = anchor + (s - graceMinutes) * 60_000;
    const to   = anchor + (e + graceMinutes) * 60_000;
    return t >= from && t <= to;
  };

  return check(day.startTime, day.endTime) || check(day.startTime2, day.endTime2);
}

/** True when this assignment would print a blank Expected column. */
export function hasNoPlannedTimes(
  a: Pick<JobRequestAssignment, "plannedIn1" | "plannedOut1" | "plannedIn2" | "plannedOut2">,
  day: Pick<JobRequestDay, "startTime" | "endTime" | "startTime2" | "endTime2"> | null | undefined,
): boolean {
  return resolvePlannedTimes(a, day).isEmpty;
}
