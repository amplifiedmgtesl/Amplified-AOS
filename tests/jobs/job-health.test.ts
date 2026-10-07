import { describe, expect, it } from "vitest";
import type { HealthContext, Finding } from "@/lib/job-health/types";
import { CHECKS } from "@/lib/job-health/registry";
import { dayIsOver } from "@/lib/job-health/checks/crew-timesheet";
import { fixLinkFor } from "@/lib/job-health/fix-link";

// Minimal fixture: a two-day job, Sep 12–13, evaluated on Sep 14 afternoon.
function ctx(over: Partial<HealthContext> = {}): HealthContext {
  return {
    jobRequest: { id: "job1", requestDate: "2026-09-12", endDate: "2026-09-13", notes: "" } as any,
    days: [
      { id: "d1", eventDate: "2026-09-12", startTime: "08:00", endTime: "17:00" },
      { id: "d2", eventDate: "2026-09-13", startTime: "08:00", endTime: "17:00" },
    ] as any,
    crewNeeds: [],
    assignments: [],
    shifts: [],
    rateCard: null,
    rateCardSource: "none",
    quotes: [],
    invoices: [],
    timesheetEntries: [],
    specialties: [],
    captures: [],
    now: new Date(2026, 8, 14, 15, 0),
    ...over,
  };
}

const row = (o: Record<string, unknown>) => ({
  id: "r" + Math.random(), firstName: "Pat", lastName: "Lee", employeeKey: "e1",
  workDate: "2026-09-12", timeIn1: "", timeOut1: "", timeIn2: "", timeOut2: "",
  status: "planned", positionId: "p1", specialtyId: null, shiftId: null, ...o,
}) as any;

const run = (c: HealthContext): Finding[] => CHECKS.flatMap((fn) => fn(c));
const ids = (c: HealthContext) => run(c).map((f) => f.id.split(":")[0]);

describe("dayIsOver", () => {
  it("a day is over at noon the next day (covers shifts past midnight)", () => {
    expect(dayIsOver("2026-09-12", new Date(2026, 8, 13, 11, 59))).toBe(false);
    expect(dayIsOver("2026-09-12", new Date(2026, 8, 13, 12, 0))).toBe(true);
    expect(dayIsOver(undefined, new Date())).toBe(false);
  });
});

describe("planned vs actual checks", () => {
  it("flags planned rows with no time once the day is over, not before", () => {
    expect(ids(ctx({ timesheetEntries: [row({})] }))).toContain("timesheet.no_actual_time");
    expect(ids(ctx({ timesheetEntries: [row({ workDate: "2026-09-14" })] }))).not.toContain("timesheet.no_actual_time");
    expect(ids(ctx({ timesheetEntries: [row({ status: "no_show" })] }))).not.toContain("timesheet.no_actual_time");
  });

  it("flags a Time In with no Time Out", () => {
    const c = ctx({ timesheetEntries: [row({ status: "submitted", timeIn1: "08:00" })] });
    expect(ids(c)).toContain("timesheet.missing_time_out");
  });

  it("flags pending time left unapproved after the day", () => {
    const c = ctx({ timesheetEntries: [row({ status: "submitted", timeIn1: "08:00", timeOut1: "17:00" })] });
    expect(ids(c)).toContain("timesheet.unapproved_past");
  });

  it("blocks when a Time Clock punch never reached the timesheet", () => {
    const e = row({ status: "planned" });
    const c = ctx({ timesheetEntries: [e], captures: [{ timesheetEntryId: e.id, in1: true, out1: false, in2: false, out2: false }] });
    const f = run(c).find((x) => x.id === "timesheet.capture_without_time");
    expect(f?.severity).toBe("blocker");
    const ok = ctx({ timesheetEntries: [{ ...e, timeIn1: "08:00" }], captures: [{ timesheetEntryId: e.id, in1: true, out1: false, in2: false, out2: false }] });
    expect(ids(ok)).not.toContain("timesheet.capture_without_time");
  });

  it("flags rows missing position, specialty or shift", () => {
    const shifts = [{ id: "s1" }, { id: "s2" }] as any;
    const specialties = [{ id: "sp1", positionId: "p1", isActive: true }] as any;
    const c = ctx({ shifts, specialties, timesheetEntries: [row({ workDate: "2026-09-14" })] });
    const f = run(c).find((x) => x.id === "timesheet.missing_role");
    expect(f?.detail).toContain("specialty, shift");
  });

  it("warns when the timesheet has crew but Assigned Crew is empty", () => {
    expect(ids(ctx({ timesheetEntries: [row({})] }))).toContain("crew.no_assigned_crew");
  });

  it("notes walk-ups who weren't planned", () => {
    const c = ctx({
      assignments: [{ jobRequestDayId: "d1", employeeKey: "e1", confirmed: true }] as any,
      timesheetEntries: [row({}), row({ employeeKey: "e2", firstName: "Sam" })],
    });
    const f = run(c).find((x) => x.id === "crew.unplanned_worker");
    expect(f?.detail).toContain("Sam");
    expect(f?.detail).not.toContain("Pat");
  });

  it("flags timesheet dates that aren't job days", () => {
    expect(ids(ctx({ timesheetEntries: [row({ workDate: "2026-09-20" })] }))).toContain("timesheet.date_not_on_job");
  });

  it("flags assigned crew with no shift on a multi-shift job", () => {
    const c = ctx({ shifts: [{ id: "s1" }, { id: "s2" }] as any, assignments: [{ jobRequestDayId: "d1", employeeKey: "e1", confirmed: true }] as any });
    expect(ids(c)).toContain("crew.assignment_missing_shift");
  });

  it("notes unconfirmed crew in the next two days only", () => {
    const days = [{ id: "d9", eventDate: "2026-09-16", startTime: "08:00" }, { id: "d10", eventDate: "2026-09-20", startTime: "08:00" }] as any;
    const assignments = [
      { jobRequestDayId: "d9", employeeKey: "e1", confirmed: false },
      { jobRequestDayId: "d10", employeeKey: "e2", confirmed: false },
    ] as any;
    const f = run(ctx({ days, assignments })).find((x) => x.id === "crew.unconfirmed_soon");
    expect(f?.title).toContain("1 assigned");
  });
});

describe("updated existing checks", () => {
  it("a day with crew and no times is a blocker that never gates a quote", () => {
    const days = [{ id: "d1", eventDate: "2026-09-12" }] as any;
    const assignments = [{ jobRequestDayId: "d1", employeeKey: "e1", confirmed: true }] as any;
    const f = run(ctx({ days, assignments })).find((x) => x.id.startsWith("job.day_no_time_window"));
    expect(f?.severity).toBe("blocker");
    expect(f?.category).toBe("crew");
    const lead = run(ctx({ days })).find((x) => x.id.startsWith("job.day_no_time_window"));
    expect(lead?.severity).toBe("warning");
  });

  it("an open spot doesn't count as filled", () => {
    const crewNeeds = [{ jobRequestDayId: "d1", quantity: 1 }] as any;
    const assignments = [{ jobRequestDayId: "d1", employeeKey: "", confirmed: false }] as any;
    expect(ids(ctx({ crewNeeds, assignments }))).toContain("job.under_assigned");
  });

  it("empty job notes are no longer a finding", () => {
    expect(ids(ctx())).not.toContain("job.no_requirements");
  });

  it("no finding shows a dollar amount (only $0 is allowed)", () => {
    const rateCard = { id: "rc", name: "Card", rows: [{ position: "Hand", specialty: "General", specialtyId: "sp1", day: 440, hourly: 43 }] } as any;
    const crewNeeds = [{ jobRequestDayId: "d1", quantity: 1, specialtyId: "sp1" }] as any;
    for (const f of run(ctx({ rateCard, crewNeeds }))) {
      const text = `${f.title} ${f.detail} ${f.downstream}`;
      expect(text.replace(/\$0\b/g, "")).not.toMatch(/\$\s?\d/);
    }
  });
});

describe("fix links by role", () => {
  it("admins get every link", () => {
    expect(fixLinkFor("/rate-card", "admin")).toEqual({ href: "/rate-card" });
  });
  it("admin-only screens become 'an admin needs to fix this' for everyone else", () => {
    for (const r of ["coordinator", "crew_leader"]) {
      expect(fixLinkFor("/rate-card", r)).toEqual({ adminOnly: true });
      expect(fixLinkFor("/invoices/x", r)).toEqual({ adminOnly: true });
    }
  });
  it("crew leaders are sent to their own copies of shared screens", () => {
    expect(fixLinkFor("/timekeeping", "crew_leader")).toEqual({ href: "/lead/timekeeping" });
    expect(fixLinkFor("/job-requests/job1?tab=crew", "crew_leader")).toEqual({ href: "/lead/jobs/job1?tab=crew" });
    expect(fixLinkFor("/job-requests?id=job1&tab=health", "crew_leader")).toEqual({ href: "/lead/jobs/job1?tab=health" });
    expect(fixLinkFor("/timekeeping", "coordinator")).toEqual({ href: "/timekeeping" });
  });
});

describe("day rate: quote vs job day (#105)", () => {
  const quote = (lines: Record<string, unknown>[]) =>
    [{ id: "q1", isDraft: false, issuedAt: "2026-09-01", lines }] as any;

  it("warns when the quote sells a day rate on an Hourly day", () => {
    const c = ctx({ quotes: quote([{ quoteDate: "2026-09-12", rateMode: "day" }]) });
    expect(ids(c)).toContain("consistency.day_rate_quoted_day_hourly");
  });

  it("is quiet when the day is set to Day Rate, or the quote line is hourly", () => {
    const days = [{ id: "d1", eventDate: "2026-09-12", startTime: "08:00", endTime: "17:00", rateMode: "day", dayRateHours: 10 }] as any;
    expect(ids(ctx({ days, quotes: quote([{ quoteDate: "2026-09-12", rateMode: "day" }]) })))
      .not.toContain("consistency.day_rate_quoted_day_hourly");
    expect(ids(ctx({ quotes: quote([{ quoteDate: "2026-09-12", rateMode: "hourly" }]) })))
      .not.toContain("consistency.day_rate_quoted_day_hourly");
  });

  it("warns when a quoted day-rate date has no job day at all", () => {
    const c = ctx({ quotes: quote([{ quoteDate: "2026-09-20", rateMode: "day" }]) });
    expect(ids(c)).toContain("consistency.day_rate_quoted_no_day");
  });
});
