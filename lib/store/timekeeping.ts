
import type { TimeEntry, Timesheet } from "./types";

export const POSITIONS = [
  "Stagehand","Rigger","Rigger 1","Audio Technician","Lighting Technician","Video Technician",
  "Fork Op","Camera Op","Operations","Lead","Other"
];

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
export function lunchOptions() {
  return [0, 15, 30, 45, 60, 90];
}
function minutes(t: string) {
  if (!t) return null;
  const [h,m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h*60 + m;
}
export function computeTimeEntry(entry: TimeEntry): TimeEntry {
  const in1 = minutes(entry.timeIn1);
  const out1 = minutes(entry.timeOut1);
  const in2 = minutes(entry.timeIn2);
  const out2 = minutes(entry.timeOut2);
  let totalMinutes = 0;
  if (in1 != null && out1 != null && out1 > in1) totalMinutes += out1 - in1;
  if (in2 != null && out2 != null && out2 > in2) totalMinutes += out2 - in2;
  totalMinutes -= (entry.lunchMinutes || 0);
  if (totalMinutes < 0) totalMinutes = 0;
  const totalHours = +(totalMinutes / 60).toFixed(2);
  const stdHours = Math.min(8, totalHours);
  const otHours = totalHours > 8 ? Math.min(4, totalHours - 8) : 0;
  const dtHours = totalHours > 12 ? totalHours - 12 : 0;
  const totalPay = +(stdHours * entry.stdRate + otHours * entry.otRate + dtHours * entry.dtRate).toFixed(2);
  return {
    ...entry,
    stdHours: +stdHours.toFixed(2),
    otHours: +otHours.toFixed(2),
    dtHours: +dtHours.toFixed(2),
    totalHours: +totalHours.toFixed(2),
    totalPay
  };
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
    lunchMinutes: 30,
    timeIn2: "",
    timeOut2: "",
    stdHours: 0,
    otHours: 0,
    dtHours: 0,
    totalHours: 0,
    stdRate: 35,
    otRate: 52,
    dtRate: 70,
    totalPay: 0
  });
}
export function summarizeTimesheet(timesheet: Timesheet | null) {
  if (!timesheet) return [];
  const map = new Map<string, { position:string; workers:number; stdHours:number; otHours:number; dtHours:number; totalHours:number; totalPay:number }>();
  timesheet.rows.forEach((r) => {
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
