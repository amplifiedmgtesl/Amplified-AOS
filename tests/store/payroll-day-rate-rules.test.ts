import { describe, it, expect } from "vitest";
import { applyDailyRulesToCandidates } from "@/lib/store/payroll";

const row = (o: Partial<Parameters<typeof applyDailyRulesToCandidates>[0][number]> = {}) => ({
  timesheetEntryId: "ts-1",
  employeeKey: "emp-1",
  workDate: "2026-08-14",
  shiftId: "shift-1",
  position: "Stagehand",
  stdHours: 0, otHours: 0, dtHours: 0,
  ...o,
});

const get = (m: ReturnType<typeof applyDailyRulesToCandidates>, id = "ts-1") => m.get(id)!;

describe("day-rate payroll hours", () => {
  it("pays the block, not the clock, on a long day", () => {
    // Neon Nights 8/14: everyone on site worked 17 hours; the day was
    // quoted at $330 against $33/hr, so the block is 10.
    const r = get(applyDailyRulesToCandidates([row({ stdHours: 17, dayRateHours: 10 })]));
    expect(r.payStdHours).toBe(10);
    expect(r.payOtHours).toBe(0);
    expect(r.payDtHours).toBe(0);
    expect(r.payTotalHours).toBe(10);
    expect(r.payAdjustmentReason).toMatch(/Day rate/);
  });

  it("pays the full block on a short day", () => {
    const r = get(applyDailyRulesToCandidates([row({ stdHours: 3, dayRateHours: 10 })]));
    expect(r.payStdHours).toBe(10);
    expect(r.payTotalHours).toBe(10);
  });

  it("pays a half-day block as 5", () => {
    // Neon Nights 8/11 — $165 against $33/hr.
    const r = get(applyDailyRulesToCandidates([row({ stdHours: 5, dayRateHours: 5 })]));
    expect(r.payTotalHours).toBe(5);
  });

  it("collapses OT and DT into the flat block", () => {
    const r = get(applyDailyRulesToCandidates([
      row({ stdHours: 10, otHours: 5, dtHours: 2, dayRateHours: 10 }),
    ]));
    expect(r.payStdHours).toBe(10);
    expect(r.payOtHours).toBe(0);
    expect(r.payDtHours).toBe(0);
  });

  it("does NOT resurrect a no-show", () => {
    // Zero hours worked means they were not there. A day rate must not
    // conjure a paid day out of an empty row.
    const r = get(applyDailyRulesToCandidates([row({ stdHours: 0, dayRateHours: 10 })]));
    expect(r.payTotalHours).toBe(0);
  });

  it("lets an exemption override the day rate", () => {
    // dailyRulesExempt is the explicit 'pay exactly what was worked'
    // override and stays the stronger signal.
    const r = get(applyDailyRulesToCandidates([
      row({ stdHours: 6, dayRateHours: 10, dailyRulesExempt: true }),
    ]));
    expect(r.payTotalHours).toBe(6);
  });

  it("pays ONE day per split shift, not one per row", () => {
    const m = applyDailyRulesToCandidates([
      row({ timesheetEntryId: "a", stdHours: 6, dayRateHours: 10 }),
      row({ timesheetEntryId: "b", stdHours: 5, dayRateHours: 10 }),
    ]);
    const total = get(m, "a").payTotalHours + get(m, "b").payTotalHours;
    expect(total).toBe(10);
  });

  it("routes the block to the highest-paid row in the group", () => {
    const rates = new Map([["a", 25], ["b", 35]]);
    const m = applyDailyRulesToCandidates([
      row({ timesheetEntryId: "a", stdHours: 6, dayRateHours: 10 }),
      row({ timesheetEntryId: "b", stdHours: 5, dayRateHours: 10 }),
    ], rates);
    expect(get(m, "b").payTotalHours).toBe(10);
    expect(get(m, "a").payTotalHours).toBe(0);
  });
});

describe("hourly jobs are unchanged (regression)", () => {
  it("still applies the 5-hour daily minimum", () => {
    const r = get(applyDailyRulesToCandidates([row({ stdHours: 2 })]));
    expect(r.payTotalHours).toBe(5);
    expect(r.payAdjustmentReason).toMatch(/5hr min/);
  });

  it("still rounds up to the whole hour", () => {
    const r = get(applyDailyRulesToCandidates([row({ stdHours: 7.25 })]));
    expect(r.payTotalHours).toBe(8);
  });

  it("still preserves the OT/DT split from the timesheet", () => {
    const r = get(applyDailyRulesToCandidates([
      row({ stdHours: 10, otHours: 5, dtHours: 2 }),
    ]));
    expect(r.payStdHours).toBe(10);
    expect(r.payOtHours).toBe(5);
    expect(r.payDtHours).toBe(2);
  });

  it("still pays zero for a no-show", () => {
    const r = get(applyDailyRulesToCandidates([row({ stdHours: 0 })]));
    expect(r.payTotalHours).toBe(0);
  });
});
