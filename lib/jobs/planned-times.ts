// Resolving a crew member's PLANNED (scheduled) times — the "planned" side of
// the Planned-vs-Actual model.
//
// One rule, in one place, because three surfaces have to agree on it: the
// printed crew sign-in sheet's Expected column, the Time Clock kiosk's
// expected-time display, and "Copy planned → actual" on the timekeeping grid.
// If they disagree, a worker signs against one schedule while the office bills
// from another.
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
import { formatClockRange } from "@/lib/time-utils";

/** One resolved time pair. `source` says who answered, for UI badging. */
export type PlannedPair = {
  in?: string;
  out?: string;
  source: "override" | "day" | "none";
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
  if (ovIn || ovOut) return { in: ovIn || dayIn, out: ovOut || dayOut, source: "override" };
  if (dayIn || dayOut) return { in: dayIn, out: dayOut, source: "day" };
  return { source: "none" };
}

/** Resolve both planned pairs for one assignment on its day. */
export function resolvePlannedTimes(
  a: Pick<JobRequestAssignment, "plannedIn1" | "plannedOut1" | "plannedIn2" | "plannedOut2">,
  day: Pick<JobRequestDay, "startTime" | "endTime" | "startTime2" | "endTime2"> | null | undefined,
): PlannedTimes {
  const pair1 = resolvePair(a.plannedIn1, a.plannedOut1, day?.startTime, day?.endTime);
  const pair2 = resolvePair(a.plannedIn2, a.plannedOut2, day?.startTime2, day?.endTime2);
  return { pair1, pair2, isEmpty: pair1.source === "none" && pair2.source === "none" };
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

/** True when this assignment would print a blank Expected column. */
export function hasNoPlannedTimes(
  a: Pick<JobRequestAssignment, "plannedIn1" | "plannedOut1" | "plannedIn2" | "plannedOut2">,
  day: Pick<JobRequestDay, "startTime" | "endTime" | "startTime2" | "endTime2"> | null | undefined,
): boolean {
  return resolvePlannedTimes(a, day).isEmpty;
}
