// Shared formatting for the three job print documents (Crew Schedule, Crew
// Sign-In Sheet, Timesheet of Actuals) — round 3 #74/#75/#76/#77/#80.
//
// John's rule (#18 of the round-3 run): sort options, override markers, next-day
// markers, one range per line, phone format and the unassigned label must be
// IDENTICAL on all three documents. They live here so they cannot drift.
//
// Pure functions only — no React, no Supabase — so they are unit-tested in
// tests/jobs/print-format.test.ts.

import { formatClock, parseMinutes } from "@/lib/time-utils";
import type { JobRequestAssignment, JobRequestDay } from "@/lib/store/types";
import { resolvePlannedTimes } from "./planned-times";

// ─── Time ranges ─────────────────────────────────────────────────────────────

/** One printed time: "7:30 AM", flagged as an individual override and/or as
 *  falling on the calendar day after the work date. */
export type PrintTime = { text: string; override: boolean; nextDay: boolean };

/** One printed block, e.g. 8:00 PM – 2:00 AM (+1). Either side may be null. */
export type PrintRange = { start: PrintTime | null; end: PrintTime | null };

/**
 * Which of the four times fall on the day AFTER the work date.
 *
 * Mirrors inferPairDates() in lib/time-utils.ts exactly, because that is what
 * the hours math uses: pair 1's out rolls over when it is earlier than its in;
 * pair 2 starts on pair 1's out date and its out rolls over the same way.
 * If the printed "(+1)" disagreed with the hours calculation, the paper would
 * contradict the pay record.
 */
export function nextDayFlags(
  in1?: string, out1?: string, in2?: string, out2?: string,
): [boolean, boolean, boolean, boolean] {
  const i1 = parseMinutes(in1 ?? "");
  const o1 = parseMinutes(out1 ?? "");
  const i2 = parseMinutes(in2 ?? "");
  const o2 = parseMinutes(out2 ?? "");
  const out1Next = i1 != null && o1 != null && o1 < i1;
  const in2Next = out1Next;
  const out2Next = in2Next || (i2 != null && o2 != null && o2 < i2);
  return [false, out1Next, in2Next, out2Next];
}

function printTime(value: string | undefined, override: boolean, nextDay: boolean): PrintTime | null {
  const text = formatClock(value);
  return text ? { text, override, nextDay } : null;
}

function nonEmpty(r: PrintRange): boolean {
  return !!(r.start || r.end);
}

/**
 * The PLANNED blocks for one assignment, resolved by lib/jobs/planned-times.ts
 * (the one fallback rule every surface shares), with each time marked when it
 * is the person's own.
 */
export function plannedRanges(
  a: Pick<JobRequestAssignment, "plannedIn1" | "plannedOut1" | "plannedIn2" | "plannedOut2">,
  day: Pick<JobRequestDay, "startTime" | "endTime" | "startTime2" | "endTime2"> | null | undefined,
): PrintRange[] {
  const { pair1, pair2 } = resolvePlannedTimes(a, day);
  const in1 = pair1.in, out1 = pair1.out, in2 = pair2.in, out2 = pair2.out;
  const [n1, n2, n3, n4] = nextDayFlags(in1, out1, in2, out2);
  return [
    { start: printTime(in1, !!a.plannedIn1, n1), end: printTime(out1, !!a.plannedOut1, n2) },
    { start: printTime(in2, !!a.plannedIn2, n3), end: printTime(out2, !!a.plannedOut2, n4) },
  ].filter(nonEmpty);
}

/** The day window's own blocks (no overrides possible). */
export function dayRanges(
  day: Pick<JobRequestDay, "startTime" | "endTime" | "startTime2" | "endTime2">,
): PrintRange[] {
  return plannedRanges({}, day);
}

/** ACTUAL blocks recorded on a timesheet row. Never marked as overrides. */
export function actualRanges(e: { timeIn1?: string; timeOut1?: string; timeIn2?: string; timeOut2?: string }): PrintRange[] {
  const [n1, n2, n3, n4] = nextDayFlags(e.timeIn1, e.timeOut1, e.timeIn2, e.timeOut2);
  return [
    { start: printTime(e.timeIn1, false, n1), end: printTime(e.timeOut1, false, n2) },
    { start: printTime(e.timeIn2, false, n3), end: printTime(e.timeOut2, false, n4) },
  ].filter(nonEmpty);
}

/** Plain text for one time, with its markers: "7:30 AM*", "2:00 AM (+1)". */
export function printTimeText(t: PrintTime | null, missing = "?"): string {
  if (!t) return missing;
  return `${t.text}${t.override ? "*" : ""}${t.nextDay ? " (+1)" : ""}`;
}

/** Plain text for one block: "8:00 PM – 2:00 AM (+1)". */
export function printRangeText(r: PrintRange): string {
  return `${printTimeText(r.start)} – ${printTimeText(r.end)}`;
}

/** True when any time in these ranges is an individual override — drives the
 *  one-line "* individual time" key under a table. */
export function anyOverride(ranges: PrintRange[]): boolean {
  return ranges.some((r) => !!(r.start?.override || r.end?.override));
}

// ─── Phone ───────────────────────────────────────────────────────────────────

/** "7348331268", "734-833-1268", "+1 (734) 833-1268" → "(734) 833-1268".
 *  Anything that isn't a 10-digit US number (after an optional leading 1) is
 *  returned trimmed and otherwise untouched — never guess at a foreign format. */
export function formatPhone(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return s;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

export type PrintSort = "last" | "first" | "position";

export const PRINT_SORT_LABEL: Record<PrintSort, string> = {
  last: "Last name",
  first: "First name",
  position: "Position / Specialty",
};

export function parsePrintSort(v: string | null | undefined): PrintSort {
  return v === "first" || v === "position" ? v : "last";
}

/** What a row contributes to the sort. `firstName`/`lastName` blank = no
 *  person yet (an unfilled slot) — those always sort to the bottom. */
export type SortKey = { firstName: string; lastName: string; position: string; specialty: string };

/** Split a "First Middle Last" full name when separate fields aren't stored. */
export function splitFullName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** Stable sort of rows for printing. Unfilled slots last, in their original order. */
export function sortForPrint<T>(rows: T[], mode: PrintSort, key: (row: T) => SortKey): T[] {
  const indexed = rows.map((row, i) => ({ row, i, k: key(row) }));
  const hasPerson = (k: SortKey) => !!(k.firstName || k.lastName);
  indexed.sort((x, y) => {
    const px = hasPerson(x.k), py = hasPerson(y.k);
    if (px !== py) return px ? -1 : 1;
    if (!px) return x.i - y.i;
    let c = 0;
    if (mode === "position") {
      c = cmp(x.k.position, y.k.position) || cmp(x.k.specialty, y.k.specialty)
        || cmp(x.k.lastName, y.k.lastName) || cmp(x.k.firstName, y.k.firstName);
    } else if (mode === "first") {
      c = cmp(x.k.firstName, y.k.firstName) || cmp(x.k.lastName, y.k.lastName);
    } else {
      c = cmp(x.k.lastName, y.k.lastName) || cmp(x.k.firstName, y.k.firstName);
    }
    return c || x.i - y.i;
  });
  return indexed.map((x) => x.row);
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/** The one wording for a crew slot with no person picked (#82). */
export const UNASSIGNED_LABEL = "(unassigned)";
