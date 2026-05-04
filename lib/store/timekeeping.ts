
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
  const stdHours = Math.min(8, totalHours);
  const otHours = totalHours > 8 ? Math.min(4, totalHours - 8) : 0;
  const dtHours = totalHours > 12 ? totalHours - 12 : 0;
  const totalPay = +(stdHours * entry.stdRate + otHours * entry.otRate + dtHours * entry.dtRate).toFixed(2);
  return {
    ...entry,
    endDate,
    stdHours: +stdHours.toFixed(2),
    otHours: +otHours.toFixed(2),
    dtHours: +dtHours.toFixed(2),
    totalHours: +totalHours.toFixed(2),
    totalPay
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

export function blankTimeEntry(id: string): TimeEntry {
  return computeTimeEntry({
    id,
    position: "Stagehand",
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
    stdRate: 35,
    otRate: 52,
    dtRate: 70,
    totalPay: 0,
    status: "submitted",
  });
}
export function summarizeTimesheet(
  timesheet: Timesheet | null,
  filter?: (row: TimeEntry) => boolean,
) {
  if (!timesheet) return [];
  const map = new Map<string, { position:string; workers:number; stdHours:number; otHours:number; dtHours:number; totalHours:number; totalPay:number }>();
  const rows = filter ? timesheet.rows.filter(filter) : timesheet.rows;
  rows.forEach((r) => {
    const key = r.position || "Unassigned";
    if (!map.has(key)) map.set(key, { position:key, workers:0, stdHours:0, otHours:0, dtHours:0, totalHours:0, totalPay:0 });
    const agg = map.get(key)!;
    agg.workers += 1;
    agg.stdHours += r.stdHours;
    agg.otHours += r.otHours;
    agg.dtHours += r.dtHours;
    agg.totalHours += r.totalHours;
    agg.totalPay += r.totalPay;
  });
  return Array.from(map.values()).map((r)=>({
    ...r,
    stdHours:+r.stdHours.toFixed(2),
    otHours:+r.otHours.toFixed(2),
    dtHours:+r.dtHours.toFixed(2),
    totalHours:+r.totalHours.toFixed(2),
    totalPay:+r.totalPay.toFixed(2),
  }));
}
