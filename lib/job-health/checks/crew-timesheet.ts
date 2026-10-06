// Planned-vs-actual checks: the plan (Assigned Crew) and the record of what
// actually happened (Timekeeping, Time Clock). Added once Timekeeping became
// actual-time-only — rows start blank and 'planned', so a blank row after the
// day is over means someone's time is genuinely missing.
//
// No dollar amounts in any message: findings are shown to every role.

import type { CheckFn, Finding, HealthContext } from "../types";
import type { TimeEntry } from "@/lib/store/types";

/** A work day counts as over at noon the next day — late enough that a shift
 *  running past midnight has finished, early enough to chase it the morning
 *  after. Local time, same as the dates people type. */
export function dayIsOver(workDate: string | undefined, now: Date): boolean {
  if (!workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return false;
  const [y, m, d] = workDate.split("-").map(Number);
  return now.getTime() >= new Date(y, m - 1, d + 1, 12, 0, 0).getTime();
}

const who = (e: Pick<TimeEntry, "firstName" | "lastName">) =>
  `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || "(unnamed)";

function nameList(names: string[], max = 6): string {
  const uniq = [...new Set(names)];
  return uniq.slice(0, max).join(", ") + (uniq.length > max ? `, +${uniq.length - max} more` : "");
}

function groupByDay(rows: TimeEntry[]): Map<string, TimeEntry[]> {
  const m = new Map<string, TimeEntry[]>();
  for (const r of rows) {
    const k = r.workDate || "(no date)";
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return new Map([...m].sort(([a], [b]) => a.localeCompare(b)));
}

/** Rows that represent someone expected to work (not a no-show / rejected). */
const isLive = (e: TimeEntry) => e.status !== "no_show" && e.status !== "rejected";

const jobHref = (ctx: HealthContext, tab: string) =>
  `/job-requests/${encodeURIComponent(ctx.jobRequest.id)}?tab=${tab}`;

export const crewTimesheetChecks: CheckFn[] = [
  // 1. Day is over but people still have no time at all.
  (ctx) => {
    const rows = ctx.timesheetEntries.filter((e) => e.status === "planned" && dayIsOver(e.workDate, ctx.now));
    return [...groupByDay(rows)].map(([day, list]) => ({
      id: `timesheet.no_actual_time:${day}`,
      severity: "warning",
      category: "timesheet",
      title: `No time entered: ${list.length} ${list.length === 1 ? "person" : "people"} on ${day}`,
      detail: `${nameList(list.map(who))} — the day is over but no actual time has been entered.`,
      downstream: "They won't be invoiced or paid until their real times are entered, or they're marked No Show.",
      fixHref: "/timekeeping",
      fixLabel: "Enter times on Timekeeping",
    } satisfies Finding));
  },

  // 2. Signed in but never signed out.
  (ctx) => {
    const rows = ctx.timesheetEntries.filter((e) =>
      isLive(e) && dayIsOver(e.workDate, ctx.now)
      && ((e.timeIn1 && !e.timeOut1) || (e.timeIn2 && !e.timeOut2)));
    return [...groupByDay(rows)].map(([day, list]) => ({
      id: `timesheet.missing_time_out:${day}`,
      severity: "warning",
      category: "timesheet",
      title: `Missing Time Out on ${day}`,
      detail: `${nameList(list.map(who))} — has a Time In with no matching Time Out.`,
      downstream: "Hours for that block count as zero until the Time Out is entered.",
      fixHref: "/timekeeping",
      fixLabel: "Enter the Time Out on Timekeeping",
    } satisfies Finding));
  },

  // 3. Time entered, day over, still waiting for approval.
  (ctx) => {
    const rows = ctx.timesheetEntries.filter((e) => e.status === "submitted" && dayIsOver(e.workDate, ctx.now));
    if (rows.length === 0) return [];
    const days = [...groupByDay(rows).keys()];
    return [{
      id: "timesheet.unapproved_past",
      severity: "warning",
      category: "timesheet",
      title: `${rows.length} timesheet ${rows.length === 1 ? "row" : "rows"} waiting for approval`,
      detail: `Pending on ${days.slice(0, 5).join(", ")}${days.length > 5 ? `, +${days.length - 5} more` : ""}.`,
      downstream: "Only approved time goes on invoices and into payroll.",
      fixHref: "/timekeeping/review",
      fixLabel: "Approve on Timesheet Review",
    }];
  },

  // 4. A Time Clock punch was captured but never reached the timesheet (#44).
  (ctx) => {
    const byId = new Map(ctx.timesheetEntries.map((e) => [e.id, e] as const));
    const lost: string[] = [];
    for (const c of ctx.captures) {
      const e = byId.get(c.timesheetEntryId);
      if (!e) continue;
      const missing = (c.in1 && !e.timeIn1) || (c.out1 && !e.timeOut1) || (c.in2 && !e.timeIn2) || (c.out2 && !e.timeOut2);
      if (missing) lost.push(`${who(e)} (${e.workDate ?? "no date"})`);
    }
    if (lost.length === 0) return [];
    return [{
      id: "timesheet.capture_without_time",
      severity: "blocker",
      category: "timesheet",
      title: `Time Clock punch not on the timesheet: ${lost.length} ${lost.length === 1 ? "row" : "rows"}`,
      detail: `${nameList(lost)} — clocked in or out at the Time Clock, but the time didn't save to Timekeeping.`,
      downstream: "The signature is on file but the hours aren't. Enter the time by hand from the sign-in record.",
      fixHref: "/timekeeping",
      fixLabel: "Enter the time on Timekeeping",
    }];
  },

  // 5. Rows whose time boxes are locked: missing position / specialty / shift.
  //    Approved rows are covered (as a blocker) by timesheet.missing_specialty.
  (ctx) => {
    const posWithSpecs = new Set(ctx.specialties.filter((s) => s.isActive !== false).map((s) => s.positionId));
    const multiShift = ctx.shifts.length >= 2;
    const gaps: string[] = [];
    for (const e of ctx.timesheetEntries) {
      if (!isLive(e) || e.status === "approved") continue;
      const miss: string[] = [];
      if (!e.positionId) miss.push("position");
      else if (posWithSpecs.has(e.positionId) && !e.specialtyId) miss.push("specialty");
      if (multiShift && !e.shiftId) miss.push("shift");
      if (miss.length) gaps.push(`${who(e)} (${miss.join(", ")})`);
    }
    if (gaps.length === 0) return [];
    return [{
      id: "timesheet.missing_role",
      severity: "warning",
      category: "timesheet",
      title: `${gaps.length} timesheet ${gaps.length === 1 ? "row is" : "rows are"} missing a position, specialty or shift`,
      detail: `${nameList(gaps)}.`,
      downstream: "Times can't be entered on these rows (or at the Time Clock) until they're filled in.",
      fixHref: "/timekeeping",
      fixLabel: "Fill them in on Timekeeping",
    }];
  },

  // 6. Timesheet in use but nobody planned on Assigned Crew.
  (ctx) => {
    const planned = ctx.assignments.filter((a) => a.employeeKey);
    if (planned.length > 0 || ctx.timesheetEntries.length === 0) return [];
    return [{
      id: "crew.no_assigned_crew",
      severity: "warning",
      category: "crew",
      title: "Timesheet has crew but Assigned Crew is empty",
      detail: "People were added straight to Timekeeping without being planned on the job.",
      downstream: "The crew schedule, sign-in sheet and Time Clock have nobody's planned times.",
      fixHref: jobHref(ctx, "crew"),
      fixLabel: "Plan the crew on the Assigned Crew tab",
    }];
  },

  // 7. Worked but not on the plan (walk-ups). Informational.
  (ctx) => {
    const planned = ctx.assignments.filter((a) => a.employeeKey);
    if (planned.length === 0) return [];   // #6 covers the whole-job case
    const dayDate = new Map(ctx.days.map((d) => [d.id, d.eventDate] as const));
    const plannedKey = new Set(planned.map((a) => `${a.employeeKey}|${dayDate.get(a.jobRequestDayId) ?? ""}`));
    const extra = ctx.timesheetEntries.filter((e) =>
      isLive(e) && e.employeeKey && !plannedKey.has(`${e.employeeKey}|${e.workDate ?? ""}`));
    if (extra.length === 0) return [];
    return [{
      id: "crew.unplanned_worker",
      severity: "info",
      category: "crew",
      title: `${extra.length} timesheet ${extra.length === 1 ? "row isn't" : "rows aren't"} on Assigned Crew`,
      detail: `${nameList(extra.map((e) => `${who(e)} (${e.workDate ?? "no date"})`))}.`,
      downstream: "Usually walk-ups added on site. Fine — but they won't be on printed schedules.",
    }];
  },

  // 8. Timesheet rows on a date that isn't one of the job's days.
  (ctx) => {
    if (ctx.days.length === 0) return [];
    const jobDays = new Set(ctx.days.map((d) => d.eventDate));
    const stray = ctx.timesheetEntries.filter((e) => e.workDate && !jobDays.has(e.workDate));
    if (stray.length === 0) return [];
    const dates = [...new Set(stray.map((e) => e.workDate!))].sort();
    return [{
      id: "timesheet.date_not_on_job",
      severity: "warning",
      category: "timesheet",
      title: `Timesheet has rows on ${dates.length === 1 ? "a date" : "dates"} not on the job: ${dates.join(", ")}`,
      detail: `${stray.length} ${stray.length === 1 ? "row is" : "rows are"} dated outside the job's Daily Requirements.`,
      downstream: "Either the date is wrong on the timesheet, or the day is missing from Daily Requirements.",
      fixHref: jobHref(ctx, "daily"),
      fixLabel: "Check the days on Daily Requirements",
    }];
  },

  // 9. Assigned crew without a shift on a multi-shift job.
  (ctx) => {
    if (ctx.shifts.length < 2) return [];
    const dayDate = new Map(ctx.days.map((d) => [d.id, d.eventDate] as const));
    const rows = ctx.assignments.filter((a) => a.employeeKey && !a.shiftId);
    if (rows.length === 0) return [];
    const days = [...new Set(rows.map((a) => dayDate.get(a.jobRequestDayId) ?? "?"))].sort();
    return [{
      id: "crew.assignment_missing_shift",
      severity: "warning",
      category: "crew",
      title: `${rows.length} assigned crew ${rows.length === 1 ? "member has" : "members have"} no shift`,
      detail: `This job has more than one shift. Missing on ${days.join(", ")}.`,
      downstream: "Their Timekeeping rows will be locked until a shift is set.",
      fixHref: jobHref(ctx, "crew"),
      fixLabel: "Set shifts on the Assigned Crew tab",
    }];
  },

  // 10. Unconfirmed crew in the next two days.
  (ctx) => {
    const today = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate());
    const soon = new Map<string, number>();
    for (const d of ctx.days) {
      const [y, m, dd] = d.eventDate.split("-").map(Number);
      const diff = Math.round((new Date(y, m - 1, dd).getTime() - today.getTime()) / 86400000);
      if (diff >= 0 && diff <= 2) soon.set(d.id, diff);
    }
    if (soon.size === 0) return [];
    const dayDate = new Map(ctx.days.map((d) => [d.id, d.eventDate] as const));
    const rows = ctx.assignments.filter((a) => a.employeeKey && !a.confirmed && soon.has(a.jobRequestDayId));
    if (rows.length === 0) return [];
    const days = [...new Set(rows.map((a) => dayDate.get(a.jobRequestDayId)!))].sort();
    return [{
      id: "crew.unconfirmed_soon",
      severity: "info",
      category: "crew",
      title: `${rows.length} assigned crew not yet confirmed`,
      detail: `For ${days.join(", ")}.`,
      downstream: "Check they're coming, then tick Confirmed.",
      fixHref: jobHref(ctx, "crew"),
      fixLabel: "Confirm on the Assigned Crew tab",
    }];
  },
];
