import { describe, it, expect } from "vitest";
import {
  applyDailyPayrollRules,
  applyWeeklySpill,
  applyDailyRulesToCandidates,
  recomputePayFromBase,
  payWeekStartFor,
  PAYROLL_DAILY_MINIMUM_HOURS,
  PAYROLL_WEEKLY_OT_THRESHOLD,
  PAYROLL_OT_MULTIPLIER,
  PAYROLL_DT_MULTIPLIER,
  type WeekHourRow,
} from "@/lib/store/payroll";

describe("payroll constants", () => {
  it("matches Connor's stated policy", () => {
    expect(PAYROLL_DAILY_MINIMUM_HOURS).toBe(5);
    expect(PAYROLL_WEEKLY_OT_THRESHOLD).toBe(40);
    expect(PAYROLL_OT_MULTIPLIER).toBe(1.5);
    expect(PAYROLL_DT_MULTIPLIER).toBe(2.0);
  });
});

describe("applyDailyPayrollRules — the 5-hour minimum", () => {
  // THE regression test. Backlog #34 flags that the exempt branch sits
  // directly in front of this logic and has never run against real data, so
  // the risk that matters is a NORMAL day silently losing its floor.
  it("pays a short day up to 5 hours on a non-exempt job", () => {
    const r = applyDailyPayrollRules({ stdHours: 3, otHours: 0, dtHours: 0 });
    expect(r.payStdHours).toBe(5);
    expect(r.payTotalHours).toBe(5);
    expect(r.reasons.join(" ")).toContain("5hr min applied");
  });

  it("puts the whole bump in std, never in OT or DT", () => {
    const r = applyDailyPayrollRules({ stdHours: 1, otHours: 0, dtHours: 0 });
    expect(r).toMatchObject({ payStdHours: 5, payOtHours: 0, payDtHours: 0 });
  });

  it("does not bump a day already at the floor", () => {
    const r = applyDailyPayrollRules({ stdHours: 5, otHours: 0, dtHours: 0 });
    expect(r.payTotalHours).toBe(5);
    expect(r.reasons).toEqual([]);
  });

  it("does not bump a day past the floor", () => {
    const r = applyDailyPayrollRules({ stdHours: 8, otHours: 0, dtHours: 0 });
    expect(r.payTotalHours).toBe(8);
    expect(r.reasons).toEqual([]);
  });

  it("pays nothing for a no-show — the floor does not create phantom hours", () => {
    const r = applyDailyPayrollRules({ stdHours: 0, otHours: 0, dtHours: 0 });
    expect(r).toMatchObject({
      payStdHours: 0, payOtHours: 0, payDtHours: 0, payTotalHours: 0,
    });
    expect(r.reasons).toEqual([]);
  });

  it("clamps negative inputs to zero rather than paying a negative day", () => {
    const r = applyDailyPayrollRules({ stdHours: -3, otHours: 0, dtHours: 0 });
    expect(r.payTotalHours).toBe(0);
  });
});

describe("applyDailyPayrollRules — whole-hour round-up", () => {
  it("rounds a partial hour up", () => {
    const r = applyDailyPayrollRules({ stdHours: 7.5, otHours: 0, dtHours: 0 });
    expect(r.payStdHours).toBe(8);
    expect(r.reasons.join(" ")).toContain("rounded 7.50→8");
  });

  it("leaves a whole-hour day alone", () => {
    const r = applyDailyPayrollRules({ stdHours: 8, otHours: 0, dtHours: 0 });
    expect(r.payTotalHours).toBe(8);
    expect(r.reasons).toEqual([]);
  });

  it("extends OT when the day ended in OT", () => {
    // Connor's rule: the rounded-up remainder continues the last-active
    // bucket, so a half hour of OT is not paid as cheap straight time.
    const r = applyDailyPayrollRules({ stdHours: 10, otHours: 2.5, dtHours: 0 });
    expect(r.payStdHours).toBe(10);
    expect(r.payOtHours).toBe(3);
    expect(r.payDtHours).toBe(0);
    expect(r.payTotalHours).toBe(13);
  });

  it("extends DT when the day ended in DT, in preference to OT", () => {
    // 10 + 5 + 1.25 = 16.25 -> ceil 17, so 0.75 extra lands on DT.
    const r = applyDailyPayrollRules({ stdHours: 10, otHours: 5, dtHours: 1.25 });
    expect(r.payStdHours).toBe(10);
    expect(r.payOtHours).toBe(5);
    expect(r.payDtHours).toBe(2);
    expect(r.payTotalHours).toBe(17);
  });

  it("applies the floor first, then the round-up", () => {
    // 2.5 -> floor to 5 -> already whole, so no second bump.
    const r = applyDailyPayrollRules({ stdHours: 2.5, otHours: 0, dtHours: 0 });
    expect(r.payTotalHours).toBe(5);
  });

  it("does not round up a day that is already whole after the floor", () => {
    const r = applyDailyPayrollRules({ stdHours: 4, otHours: 0, dtHours: 0 });
    expect(r.payTotalHours).toBe(5);
    expect(r.reasons.join(" ")).not.toContain("rounded");
  });

  it("preserves the timesheet's OT/DT split verbatim", () => {
    const r = applyDailyPayrollRules({ stdHours: 10, otHours: 3, dtHours: 2 });
    expect(r).toMatchObject({ payStdHours: 10, payOtHours: 3, payDtHours: 2 });
  });
});

describe("applyDailyPayrollRules — exemptions", () => {
  it("pays exact hours on a short exempt day, waiving the floor", () => {
    const r = applyDailyPayrollRules({
      stdHours: 3, otHours: 0, dtHours: 0, dailyRulesExempt: true,
    });
    expect(r.payTotalHours).toBe(3);
    expect(r.reasons).toEqual(["daily rules waived (exempt)"]);
  });

  it("waives the round-up too, not just the floor", () => {
    // Confirmed with Connor 2026-08-04: exemption covers both rules.
    const r = applyDailyPayrollRules({
      stdHours: 7.5, otHours: 0, dtHours: 0, dailyRulesExempt: true,
    });
    expect(r.payTotalHours).toBe(7.5);
    expect(r.payStdHours).toBe(7.5);
  });

  it("leaves the OT/DT buckets untouched when exempt", () => {
    const r = applyDailyPayrollRules({
      stdHours: 10, otHours: 2.5, dtHours: 1.25, dailyRulesExempt: true,
    });
    expect(r).toMatchObject({
      payStdHours: 10, payOtHours: 2.5, payDtHours: 1.25, payTotalHours: 13.75,
    });
  });

  it("still pays nothing for an exempt no-show", () => {
    const r = applyDailyPayrollRules({
      stdHours: 0, otHours: 0, dtHours: 0, dailyRulesExempt: true,
    });
    expect(r.payTotalHours).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it("treats an absent flag as non-exempt", () => {
    expect(applyDailyPayrollRules({ stdHours: 3, otHours: 0, dtHours: 0 }).payTotalHours)
      .toBe(5);
    expect(applyDailyPayrollRules({
      stdHours: 3, otHours: 0, dtHours: 0, dailyRulesExempt: false,
    }).payTotalHours).toBe(5);
  });
});

describe("payWeekStartFor", () => {
  it("maps a midweek day back to Sunday", () => {
    // 2026-08-06 is a Thursday; the Sunday of that week is 2026-08-02.
    expect(payWeekStartFor("2026-08-06", "sun")).toBe("2026-08-02");
  });

  it("maps a midweek day back to Monday", () => {
    expect(payWeekStartFor("2026-08-06", "mon")).toBe("2026-08-03");
  });

  it("leaves a Sunday alone under a Sunday week start", () => {
    expect(payWeekStartFor("2026-08-02", "sun")).toBe("2026-08-02");
  });

  it("sends a Sunday back six days under a Monday week start", () => {
    // The classic off-by-one: Sunday belongs to the PREVIOUS Monday's week.
    expect(payWeekStartFor("2026-08-09", "mon")).toBe("2026-08-03");
  });

  it("leaves a Monday alone under a Monday week start", () => {
    expect(payWeekStartFor("2026-08-03", "mon")).toBe("2026-08-03");
  });

  it("handles a Saturday", () => {
    expect(payWeekStartFor("2026-08-08", "sun")).toBe("2026-08-02");
    expect(payWeekStartFor("2026-08-08", "mon")).toBe("2026-08-03");
  });

  it("crosses a month boundary", () => {
    // 2026-03-02 is a Monday; the Sunday before is 2026-03-01.
    expect(payWeekStartFor("2026-03-02", "sun")).toBe("2026-03-01");
  });

  it("crosses a year boundary", () => {
    // 2026-01-01 is a Thursday; its Sunday is 2025-12-28.
    expect(payWeekStartFor("2026-01-01", "sun")).toBe("2025-12-28");
    expect(payWeekStartFor("2026-01-01", "mon")).toBe("2025-12-29");
  });

  it("always returns a zero-padded YYYY-MM-DD", () => {
    expect(payWeekStartFor("2026-01-08", "sun")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("applyWeeklySpill", () => {
  function row(over: Partial<WeekHourRow> & { key: string }): WeekHourRow {
    return {
      workDate: "2026-08-03", payStdHours: 8, payOtHours: 0, payDtHours: 0,
      frozen: false, ...over,
    };
  }

  it("leaves a week under 40 hours alone", () => {
    const { adjustments } = applyWeeklySpill([
      row({ key: "a", workDate: "2026-08-03" }),
      row({ key: "b", workDate: "2026-08-04" }),
    ]);
    expect(adjustments.get("a")).toMatchObject({ payStdHours: 8, payOtHours: 0, reason: null });
    expect(adjustments.get("b")!.reason).toBeNull();
  });

  it("leaves a week landing exactly on 40 alone", () => {
    const rows = [1, 2, 3, 4, 5].map((n) =>
      row({ key: `d${n}`, workDate: `2026-08-0${n + 2}` }));
    const { adjustments } = applyWeeklySpill(rows);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(adjustments.get(`d${n}`)!.reason).toBeNull();
    }
  });

  it("spills straight time past 40 into OT", () => {
    // Five 8-hour days reach 40, then a sixth day spills entirely.
    const rows = [1, 2, 3, 4, 5, 6].map((n) =>
      row({ key: `d${n}`, workDate: `2026-08-0${n + 2}` }));
    const { adjustments } = applyWeeklySpill(rows);
    expect(adjustments.get("d5")!.payStdHours).toBe(8);
    expect(adjustments.get("d6")).toMatchObject({ payStdHours: 0, payOtHours: 8 });
    expect(adjustments.get("d6")!.reason).toContain("weekly OT spill");
  });

  it("splits the row that straddles the 40-hour line", () => {
    // 36 hours in, then a 8-hour day: 4 stay std, 4 spill.
    const { adjustments } = applyWeeklySpill([
      row({ key: "prior", workDate: "2026-08-03", payStdHours: 36 }),
      row({ key: "straddle", workDate: "2026-08-04", payStdHours: 8 }),
    ]);
    expect(adjustments.get("straddle")).toMatchObject({ payStdHours: 4, payOtHours: 4 });
  });

  it("counts frozen rows toward the 40 but never mutates them", () => {
    const { adjustments } = applyWeeklySpill([
      row({ key: "done", workDate: "2026-08-03", payStdHours: 38, frozen: true }),
      row({ key: "new", workDate: "2026-08-04", payStdHours: 8 }),
    ]);
    expect(adjustments.has("done")).toBe(false);
    expect(adjustments.get("new")).toMatchObject({ payStdHours: 2, payOtHours: 6 });
  });

  it("counts frozen rows first regardless of their date", () => {
    // A frozen row dated later still already happened — it was finalized.
    const { adjustments } = applyWeeklySpill([
      row({ key: "new", workDate: "2026-08-03", payStdHours: 8 }),
      row({ key: "done", workDate: "2026-08-07", payStdHours: 38, frozen: true }),
    ]);
    expect(adjustments.get("new")).toMatchObject({ payStdHours: 2, payOtHours: 6 });
  });

  it("adds spill on top of OT the row already had", () => {
    const { adjustments } = applyWeeklySpill([
      row({ key: "prior", payStdHours: 38 }),
      row({ key: "x", workDate: "2026-08-04", payStdHours: 8, payOtHours: 2 }),
    ]);
    expect(adjustments.get("x")).toMatchObject({ payStdHours: 2, payOtHours: 8 });
  });

  it("never touches double time", () => {
    const { adjustments } = applyWeeklySpill([
      row({ key: "prior", payStdHours: 38 }),
      row({ key: "x", workDate: "2026-08-04", payStdHours: 8, payDtHours: 3 }),
    ]);
    // DT is absent from the adjustment shape entirely — only std/ot move.
    expect(adjustments.get("x")).toMatchObject({ payStdHours: 2, payOtHours: 6 });
    expect(adjustments.get("x")).not.toHaveProperty("payDtHours");
  });

  it("counts existing OT and DT toward the cumulative total", () => {
    // 30 std + 6 ot + 4 dt = 40 already consumed.
    const { adjustments } = applyWeeklySpill([
      row({ key: "prior", payStdHours: 30, payOtHours: 6, payDtHours: 4 }),
      row({ key: "x", workDate: "2026-08-04", payStdHours: 5 }),
    ]);
    expect(adjustments.get("x")).toMatchObject({ payStdHours: 0, payOtHours: 5 });
  });

  it("returns an empty adjustment set for no rows", () => {
    expect(applyWeeklySpill([]).adjustments.size).toBe(0);
  });
});

describe("applyDailyRulesToCandidates — shift grouping", () => {
  function cand(over: any = {}) {
    return {
      timesheetEntryId: "e1", employeeKey: "emp-1", workDate: "2026-08-03",
      shiftId: null, position: "Rigger",
      stdHours: 0, otHours: 0, dtHours: 0, ...over,
    };
  }

  it("gives two rows on the same shift a single shared minimum", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", shiftId: "s1", stdHours: 2 }),
      cand({ timesheetEntryId: "b", shiftId: "s1", stdHours: 2 }),
    ]);
    const total = out.get("a")!.payTotalHours + out.get("b")!.payTotalHours;
    expect(total).toBe(5);
  });

  it("gives two rows on different shifts a minimum each", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", shiftId: "s1", stdHours: 2 }),
      cand({ timesheetEntryId: "b", shiftId: "s2", stdHours: 2 }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(5);
    expect(out.get("b")!.payTotalHours).toBe(5);
  });

  it("treats null-shift rows on the same position as one shift", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", position: "Rigger", stdHours: 2 }),
      cand({ timesheetEntryId: "b", position: "Rigger", stdHours: 2 }),
    ]);
    expect(out.get("a")!.payTotalHours + out.get("b")!.payTotalHours).toBe(5);
  });

  it("treats null-shift rows on different positions as different shifts", () => {
    // Connor's "99.9% rule" fallback.
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", position: "Rigger", stdHours: 2 }),
      cand({ timesheetEntryId: "b", position: "Loader", stdHours: 2 }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(5);
    expect(out.get("b")!.payTotalHours).toBe(5);
  });

  it("separates different employees on the same shift id", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", employeeKey: "emp-1", shiftId: "s1", stdHours: 2 }),
      cand({ timesheetEntryId: "b", employeeKey: "emp-2", shiftId: "s1", stdHours: 2 }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(5);
    expect(out.get("b")!.payTotalHours).toBe(5);
  });

  it("separates the same shift on different dates", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", workDate: "2026-08-03", shiftId: "s1", stdHours: 2 }),
      cand({ timesheetEntryId: "b", workDate: "2026-08-04", shiftId: "s1", stdHours: 2 }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(5);
    expect(out.get("b")!.payTotalHours).toBe(5);
  });
});

describe("applyDailyRulesToCandidates — bump allocation", () => {
  function cand(over: any = {}) {
    return {
      timesheetEntryId: "e1", employeeKey: "emp-1", workDate: "2026-08-03",
      shiftId: "s1", position: "Rigger",
      stdHours: 0, otHours: 0, dtHours: 0, ...over,
    };
  }

  it("gives the whole bump to the highest-paid row", () => {
    const rates = new Map([["cheap", 20], ["rich", 60]]);
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "cheap", stdHours: 1 }),
      cand({ timesheetEntryId: "rich", stdHours: 1 }),
    ], rates);
    expect(out.get("rich")!.payTotalHours).toBe(4);   // 1 + 3 bump
    expect(out.get("cheap")!.payTotalHours).toBe(1);
    expect(out.get("rich")!.payAdjustmentReason).toContain("5hr min applied");
    expect(out.get("cheap")!.payAdjustmentReason).toBeNull();
  });

  it("splits the bump equally when no rates are known", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", stdHours: 1 }),
      cand({ timesheetEntryId: "b", stdHours: 1 }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(2.5);
    expect(out.get("b")!.payTotalHours).toBe(2.5);
    expect(out.get("a")!.payAdjustmentReason).toContain("split equally");
  });

  it("does not let a zero-hour row absorb the minimum", () => {
    const rates = new Map([["ghost", 100], ["worked", 20]]);
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "ghost", stdHours: 0 }),
      cand({ timesheetEntryId: "worked", stdHours: 2 }),
    ], rates);
    expect(out.get("ghost")!.payTotalHours).toBe(0);
    expect(out.get("worked")!.payTotalHours).toBe(5);
  });

  it("extends the absorber's last-active bucket", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", stdHours: 10, otHours: 2.5 }),
    ]);
    expect(out.get("a")).toMatchObject({
      payStdHours: 10, payOtHours: 3, payDtHours: 0, payTotalHours: 13,
    });
  });

  it("pays a no-show group nothing", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", stdHours: 0 }),
      cand({ timesheetEntryId: "b", stdHours: 0 }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(0);
    expect(out.get("b")!.payTotalHours).toBe(0);
    expect(out.get("a")!.payAdjustmentReason).toBeNull();
  });
});

describe("applyDailyRulesToCandidates — exemptions", () => {
  function cand(over: any = {}) {
    return {
      timesheetEntryId: "e1", employeeKey: "emp-1", workDate: "2026-08-03",
      shiftId: "s1", position: "Rigger",
      stdHours: 0, otHours: 0, dtHours: 0, ...over,
    };
  }

  it("pays exact hours and stamps the reason on an exempt shift", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", stdHours: 3, dailyRulesExempt: true }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(3);
    expect(out.get("a")!.payAdjustmentReason).toBe("5hr min + round-up waived (exempt)");
  });

  it("waives the round-up on an exempt shift", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", stdHours: 7.5, dailyRulesExempt: true }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(7.5);
  });

  it("makes the whole group exempt when any row is flagged", () => {
    // Documented as group-level: the floor applies to the shift's summed
    // hours, so there is no coherent way to waive it for one row only.
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", stdHours: 1, dailyRulesExempt: true }),
      cand({ timesheetEntryId: "b", stdHours: 1 }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(1);
    expect(out.get("b")!.payTotalHours).toBe(1);
  });

  it("does not leak exemption into a different shift group", () => {
    const out = applyDailyRulesToCandidates([
      cand({ timesheetEntryId: "a", shiftId: "s1", stdHours: 2, dailyRulesExempt: true }),
      cand({ timesheetEntryId: "b", shiftId: "s2", stdHours: 2 }),
    ]);
    expect(out.get("a")!.payTotalHours).toBe(2);
    expect(out.get("b")!.payTotalHours).toBe(5);
  });
});

describe("recomputePayFromBase", () => {
  const hours = {
    payStdHours: 8, payOtHours: 0, payDtHours: 0, payTotalHours: 8,
  };

  it("derives OT at 1.5x and DT at 2x the base", () => {
    const r = recomputePayFromBase({ baseRate: 40, isHoliday: false, ...hours });
    expect(r).toMatchObject({ stdRate: 40, otRate: 60, dtRate: 80 });
  });

  it("pays each bucket at its own rate", () => {
    const r = recomputePayFromBase({
      baseRate: 40, isHoliday: false,
      payStdHours: 10, payOtHours: 2, payDtHours: 1, payTotalHours: 13,
    });
    // 10*40 + 2*60 + 1*80 = 600
    expect(r.totalPay).toBe(600);
  });

  it("collapses holiday pay to total hours x base x multiplier", () => {
    // No OT/DT premium stacking on a holiday.
    const r = recomputePayFromBase({
      baseRate: 40, isHoliday: true, holidayMultiplier: 2,
      payStdHours: 10, payOtHours: 2, payDtHours: 1, payTotalHours: 13,
    });
    expect(r.totalPay).toBe(13 * 40 * 2);
  });

  it("defaults the holiday multiplier to 2.0", () => {
    const r = recomputePayFromBase({
      baseRate: 40, isHoliday: true, holidayMultiplier: null, ...hours,
    });
    expect(r.totalPay).toBe(8 * 40 * 2);
  });

  it("honors a non-default holiday multiplier", () => {
    const r = recomputePayFromBase({
      baseRate: 40, isHoliday: true, holidayMultiplier: 1.5, ...hours,
    });
    expect(r.totalPay).toBe(8 * 40 * 1.5);
  });

  it("clamps a negative base rate to zero", () => {
    const r = recomputePayFromBase({ baseRate: -10, isHoliday: false, ...hours });
    expect(r).toMatchObject({ stdRate: 0, otRate: 0, dtRate: 0, totalPay: 0 });
  });

  it("returns zero pay for an unset rate rather than failing", () => {
    // 0 is the "no layer had a value" sentinel; the UI surfaces a banner.
    const r = recomputePayFromBase({ baseRate: 0, isHoliday: false, ...hours });
    expect(r.totalPay).toBe(0);
  });

  it("rounds pay to cents", () => {
    const r = recomputePayFromBase({
      baseRate: 33.333, isHoliday: false,
      payStdHours: 7.5, payOtHours: 0, payDtHours: 0, payTotalHours: 7.5,
    });
    // 33.333 * 7.5 = 249.9975 -> 250.00
    expect(r.totalPay).toBe(250);
  });
});
