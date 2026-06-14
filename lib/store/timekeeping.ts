
import type { TimeEntry, Timesheet } from "./types";
import { durationMinutes } from "../time-utils";

// Note: legacy hardcoded POSITIONS list removed 2026-05-04. Position names
// now come from the positions table via positionNames() in app-store.ts.

export function timeOptions() {
  const out: string[] = [""];
  for (let h=0; h<24; h++) {
    for (let m=0; m<60; m+=5) {
      out.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
    }
  }
  return out;
}
export function rateOptions() {
  return Array.from({length: 301}).map((_,i)=>i);
}
/** Legacy — kept for back-compat with any remaining caller. Prefer mealBreakOptions. */
export function lunchOptions() {
  return [0, 15, 30, 45, 60, 90];
}
/** Meal break dropdown values: 0 (none), 30 min, 60 min. */
export function mealBreakOptions() {
  return [0, 30, 60];
}
// ⚠ SYNCED COPY: computeTimeEntry + inferPairDatesLocal are mirrored in the
// staff app at amplified-staff/lib/calc/timekeeping.ts so staff-submitted
// timesheets price identically. If you change the hours / OT-DT / holiday math
// here, mirror it there. See amplified-staff/docs/v2-alignment-plan.md.
export function computeTimeEntry(entry: TimeEntry): TimeEntry {
  const workDate = entry.workDate;
  // Auto-seed endDate: if we have a workDate, infer the true shift-end date
  // from pair crossovers rather than trusting whatever endDate happens to be
  // saved. This removes the old "advance End Date?" warning and keeps the
  // end-date field in sync with the times the user entered.
  let endDate = entry.endDate;
  let out1DateOut = workDate;
  let out2DateOut = workDate;
  if (workDate) {
    const { out1Date, out2Date } = inferPairDatesLocal(
      workDate, entry.timeIn1, entry.timeOut1, entry.timeIn2, entry.timeOut2
    );
    out1DateOut = out1Date;
    out2DateOut = out2Date;
    // Use the latest pair-out date as the authoritative end date.
    endDate = out2Date;
  }

  // Pair dates: when we have anchor dates, infer per-pair dates from the text
  // times (pair 1 rollover if out1 < in1, pair 2 starts on pair 1's out date,
  // etc.). When dates are missing (legacy rows), durationMinutes uses the +24
  // trick as a fallback.
  let totalMinutes = 0;
  if (workDate) {
    totalMinutes += durationMinutes(workDate, entry.timeIn1, out1DateOut, entry.timeOut1);
    totalMinutes += durationMinutes(out1DateOut, entry.timeIn2, out2DateOut, entry.timeOut2);
  } else {
    // Legacy fallback — same-day +24 if negative
    totalMinutes += durationMinutes(undefined, entry.timeIn1, undefined, entry.timeOut1);
    totalMinutes += durationMinutes(undefined, entry.timeIn2, undefined, entry.timeOut2);
  }

  // Meal breaks: subtract both. Fall back to legacy lunchMinutes if
  // mealBreak1Minutes isn't yet populated (pre-migration rows).
  const break1 = entry.mealBreak1Minutes ?? entry.lunchMinutes ?? 0;
  const break2 = entry.mealBreak2Minutes ?? 0;
  totalMinutes -= break1;
  totalMinutes -= break2;
  if (totalMinutes < 0) totalMinutes = 0;

  const totalHours = +(totalMinutes / 60).toFixed(2);

  // OT/DT bucket split honors per-entry thresholds (migration 20260606a).
  // Snapshotted from the rate card at entry creation. Semantics:
  //   NULL → 0 (no bucket at this tier). Was previously hardcoded to 8/12
  //          which silently broke jobs whose contract was "no OT
  //          premium" — fix landed 2026-06-06.
  //   N>0  → bucket starts after N hours.
  //
  // Two-tier split (when both thresholds active):
  //   ST = min(otAfter, total)
  //   OT = clamp(total - otAfter, 0, dtAfter - otAfter)
  //   DT = max(total - dtAfter, 0)
  const otAfter = entry.billOtAfter ?? 0;
  const dtAfter = entry.billDtAfter ?? 0;
  let stdHours: number;
  let otHours: number;
  let dtHours: number;
  if (otAfter === 0 && dtAfter === 0) {
    stdHours = totalHours;
    otHours = 0;
    dtHours = 0;
  } else if (otAfter === 0) {
    // No OT bucket; DT past dtAfter.
    stdHours = Math.min(dtAfter, totalHours);
    otHours = 0;
    dtHours = totalHours > dtAfter ? totalHours - dtAfter : 0;
  } else if (dtAfter === 0) {
    // OT past otAfter; no DT.
    stdHours = Math.min(otAfter, totalHours);
    otHours = totalHours > otAfter ? totalHours - otAfter : 0;
    dtHours = 0;
  } else {
    // Both tiers active. Misconfig guard: if otAfter >= dtAfter, OT
    // window collapses to zero and DT takes over at dtAfter.
    const otCap = Math.min(otAfter, dtAfter);
    stdHours = Math.min(otCap, totalHours);
    otHours = totalHours > otCap
      ? Math.min(dtAfter - otCap, totalHours - otCap)
      : 0;
    dtHours = totalHours > dtAfter ? totalHours - dtAfter : 0;
  }

  // Phase 4: on a holiday row, bill = totalHours × billStdRate × multiplier.
  // OT/DT premium does NOT stack on top — matches the atomic-day, flat-2×
  // rule in the quote/invoice calc engine (migration #28). On non-holiday
  // rows, the existing ST/OT/DT split applies.
  //
  // (Note: these are BILLING totals — what AES bills the client. Pay
  // totals live separately on payroll_run_entries. Renamed in 20260528b.)
  const mult = entry.isHoliday ? (entry.holidayMultiplier ?? 2.0) : 1;
  const billTotal = entry.isHoliday
    ? +(totalHours * entry.billStdRate * mult).toFixed(2)
    : +(stdHours * entry.billStdRate + otHours * entry.billOtRate + dtHours * entry.billDtRate).toFixed(2);

  return {
    ...entry,
    endDate,
    stdHours: +stdHours.toFixed(2),
    otHours: +otHours.toFixed(2),
    dtHours: +dtHours.toFixed(2),
    totalHours: +totalHours.toFixed(2),
    billTotal,
  };
}

// Local copy of inferPairDates to avoid a circular import (time-utils also
// re-exports its own version). Keeps this module self-contained.
function inferPairDatesLocal(
  workDate: string,
  timeIn1: string,
  timeOut1: string,
  timeIn2: string,
  timeOut2: string,
) {
  const parseM = (t: string) => {
    if (!t) return null;
    const match = t.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
    if (!match) return null;
    let h = Number(match[1]);
    const mm = Number(match[2]);
    if (Number.isNaN(h) || Number.isNaN(mm)) return null;
    if (match[3] === "AM" && h === 12) h = 0;
    else if (match[3] === "PM" && h !== 12) h += 12;
    return h * 60 + mm;
  };
  const bump = (ymd: string) => {
    const d = new Date(ymd + "T00:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const in1 = parseM(timeIn1); const out1 = parseM(timeOut1);
  const in2 = parseM(timeIn2); const out2 = parseM(timeOut2);
  const in1Date = workDate;
  const out1Date = (in1 != null && out1 != null && out1 < in1) ? bump(workDate) : workDate;
  const in2Date = out1Date;
  const out2Date = (in2 != null && out2 != null && out2 < in2) ? bump(in2Date) : in2Date;
  return { in1Date, out1Date, in2Date, out2Date };
}

// Default position for a freshly-seeded row. Operator picks via the
// cascading dropdown — this just keeps the row FK-clean from the start
// (position_id is the source of truth post-Phase 3; "Stagehand" is the
// canonical default position for event labor in this system).
const DEFAULT_POSITION_ID = "pos-01";

export function blankTimeEntry(id: string): TimeEntry {
  return computeTimeEntry({
    id,
    position: "Stagehand",
    positionId: DEFAULT_POSITION_ID,
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    timeIn1: "",
    timeOut1: "",
    timeIn2: "",
    timeOut2: "",
    lunchMinutes: 30,
    mealBreak1Minutes: 30,
    mealBreak2Minutes: 0,
    stdHours: 0,
    otHours: 0,
    dtHours: 0,
    totalHours: 0,
    billStdRate: 35,
    billOtRate: 52,
    billDtRate: 70,
    billTotal: 0,
    status: "submitted",
    isHoliday: false,
    holidayMultiplier: null,
  });
}
/**
 * Aggregate timesheet entries for downstream consumers (Labor Summary panels,
 * invoice "Pull labor actuals" flow).
 *
 * Phase 3 (2026-05-26): group by canonical (positionId, specialtyId) when
 * present, falling back to the legacy text `position` for rows that haven't
 * been normalized yet. Output preserves the legacy `position` string for
 * display + back-compat with callers that haven't migrated to IDs yet.
 */
export function summarizeTimesheet(
  timesheet: Timesheet | null,
  filter?: (row: TimeEntry) => boolean,
) {
  if (!timesheet) return [];
  type Agg = {
    position: string;
    positionId: string | null;
    specialtyId: string | null;
    workers: number;
    stdHours: number; otHours: number; dtHours: number;
    totalHours: number; billTotal: number;
  };
  const map = new Map<string, Agg>();
  const rows = filter ? timesheet.rows.filter(filter) : timesheet.rows;
  rows.forEach((r) => {
    // Prefer (positionId, specialtyId) as the canonical key. Fall back to
    // the legacy text so unnormalized rows still appear in their own bucket.
    const key = r.positionId
      ? `${r.positionId}|${r.specialtyId || ""}`
      : `text:${r.position || "Unassigned"}`;
    if (!map.has(key)) {
      map.set(key, {
        position: r.position || "Unassigned",
        positionId: r.positionId ?? null,
        specialtyId: r.specialtyId ?? null,
        workers: 0,
        stdHours: 0, otHours: 0, dtHours: 0,
        totalHours: 0, billTotal: 0,
      });
    }
    const agg = map.get(key)!;
    agg.workers += 1;
    agg.stdHours += r.stdHours;
    agg.otHours += r.otHours;
    agg.dtHours += r.dtHours;
    agg.totalHours += r.totalHours;
    agg.billTotal += r.billTotal;
  });
  return Array.from(map.values()).map((r)=>({
    ...r,
    stdHours:+r.stdHours.toFixed(2),
    otHours:+r.otHours.toFixed(2),
    dtHours:+r.dtHours.toFixed(2),
    totalHours:+r.totalHours.toFixed(2),
    billTotal:+r.billTotal.toFixed(2),
  }));
}
