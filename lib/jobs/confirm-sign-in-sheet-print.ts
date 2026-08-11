"use client";

// Pre-flight for the crew sign-in sheet print (#38).
//
// The sheet's whole job is to go on-site with the schedule already on it. When
// a day has no time window AND the crew on it carry no planned times of their
// own, the Expected column prints empty — the sheet still looks complete, so
// nobody notices until it's in someone's hand at the venue.
//
// This warns and lets the operator proceed. It is NOT a block: printing a
// blank-Expected sheet is sometimes exactly what you want (hand-write the
// times on site), and #38's whole finding was that a hard requirement would
// push people to type fake times to get past it.

import { loadJobRequestDays } from "@/lib/storage/job-request-days";
import { loadAssignmentsForRequest } from "@/lib/storage/job-request-assignments";
import { hasNoPlannedTimes } from "./planned-times";

/**
 * Returns true if it's OK to proceed with the print.
 * Fails OPEN — a bug in here must never stop someone printing a crew sheet.
 */
export async function confirmSignInSheetPrint(jobRequestId: string | null | undefined): Promise<boolean> {
  if (!jobRequestId) return true;
  try {
    const [days, assignments] = await Promise.all([
      loadJobRequestDays(jobRequestId),
      loadAssignmentsForRequest(jobRequestId),
    ]);
    const dayById = new Map(days.map((d) => [d.id, d]));

    // Count, per day, how many assigned crew would print a blank Expected.
    const blankByDate = new Map<string, number>();
    for (const a of assignments) {
      const day = dayById.get(a.jobRequestDayId);
      if (!day) continue;
      if (!hasNoPlannedTimes(a, day)) continue;
      blankByDate.set(day.eventDate, (blankByDate.get(day.eventDate) ?? 0) + 1);
    }
    if (blankByDate.size === 0) return true;

    const total = Array.from(blankByDate.values()).reduce((s, n) => s + n, 0);
    const lines = Array.from(blankByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 8)
      .map(([date, n]) => `  • ${date} — ${n} crew`);
    const more = blankByDate.size > 8 ? `\n  ...and ${blankByDate.size - 8} more days` : "";

    return confirm(
      `${total} crew member${total === 1 ? "" : "s"} will print with a BLANK Expected column:\n\n` +
      lines.join("\n") + more +
      `\n\nThose days have no time window set, and those crew have no planned ` +
      `times of their own, so the sheet has no schedule to print for them.\n\n` +
      `Set start/end times on the Daily Requirements tab first (recommended), ` +
      `or click OK to print the sheet with Expected left blank.`
    );
  } catch (e) {
    console.error("[sign-in-sheet] pre-flight failed:", e);
    return true; // fail open
  }
}
