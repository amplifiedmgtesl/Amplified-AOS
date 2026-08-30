import { describe, it, expect } from "vitest";
import {
  buildBillRateMap,
  priceTimesheetGroup,
  type TimesheetGroupAgg,
  type BillRate,
  type QuoteRateHint,
} from "@/lib/rates/timesheet-group-pricing";

const RATE: BillRate = { hourly: 35, otRate: 52.5, dtRate: 70 };

function group(over: Partial<TimesheetGroupAgg> = {}): TimesheetGroupAgg {
  return {
    workDate: "2026-08-01",
    endDate: null,
    positionId: "pos-1",
    positionText: "Rigger",
    specialtyId: "spec-1",
    shiftId: null,
    isHoliday: false,
    stdHours: 0,
    otHours: 0,
    dtHours: 0,
    crewCount: 1,
    workerTotalHours: new Map(),
    ...over,
  };
}

describe("buildBillRateMap", () => {
  it("keys rates by specialty_id and coerces numerics", () => {
    const m = buildBillRateMap([
      { specialty_id: "s1", hourly: "35", ot_rate: "52.5", dt_rate: "70" },
    ]);
    expect(m.get("s1")).toEqual({ hourly: 35, otRate: 52.5, dtRate: 70 });
  });

  it("skips rows with no specialty_id", () => {
    const m = buildBillRateMap([
      { specialty_id: null, hourly: 99 },
      { specialty_id: "s2", hourly: 40 },
    ]);
    expect(m.size).toBe(1);
    expect(m.has("s2")).toBe(true);
  });

  it("defaults missing rate fields to zero", () => {
    expect(buildBillRateMap([{ specialty_id: "s1" }]).get("s1"))
      .toEqual({ hourly: 0, otRate: 0, dtRate: 0 });
  });

  it("tolerates null/empty input", () => {
    expect(buildBillRateMap(null as any).size).toBe(0);
    expect(buildBillRateMap([]).size).toBe(0);
  });

  it("last row wins for a duplicated specialty", () => {
    const m = buildBillRateMap([
      { specialty_id: "s1", hourly: 35 },
      { specialty_id: "s1", hourly: 40 },
    ]);
    expect(m.get("s1")!.hourly).toBe(40);
  });
});

describe("priceTimesheetGroup — hourly mode", () => {
  it("prices ST/OT/DT against the rate card", () => {
    const { line, missingRate } = priceTimesheetGroup(
      group({ stdHours: 10, otHours: 2, dtHours: 1, crewCount: 2 }),
      { rate: RATE, hint: undefined },
    );
    expect(missingRate).toBe(false);
    expect(line.rateMode).toBe("hourly");
    // 10*35 + 2*52.5 + 1*70 = 525
    expect(line.total).toBe(525);
    expect(line.rule).toBe("Timesheet actuals");
  });

  it("flags a missing rate and zeroes the line rather than guessing", () => {
    const { line, missingRate } = priceTimesheetGroup(
      group({ stdHours: 10 }),
      { rate: undefined, hint: undefined },
    );
    expect(missingRate).toBe(true);
    expect(line.baseHourly).toBe(0);
    expect(line.total).toBe(0);
  });

  it("rounds hours to two decimals", () => {
    const { line } = priceTimesheetGroup(
      group({ stdHours: 10.005, otHours: 2.004 }),
      { rate: RATE, hint: undefined },
    );
    expect(line.hours).toBe(10.01);
    expect(line.otHours).toBe(2);
  });

  it("carries identity fields through to the line", () => {
    const { line } = priceTimesheetGroup(
      group({ stdHours: 8, endDate: "2026-08-02", shiftId: "sh-9" }),
      { rate: RATE, hint: undefined },
    );
    expect(line.serviceKey).toBe("Rigger");
    expect(line.positionId).toBe("pos-1");
    expect(line.specialtyId).toBe("spec-1");
    expect(line.shiftId).toBe("sh-9");
    expect(line.quoteDate).toBe("2026-08-01");
    expect(line.endDate).toBe("2026-08-02");
    expect(line.sourceKind).toBe("timesheet_entry");
  });

  it("applies the holiday multiplier and labels the rule", () => {
    const { line } = priceTimesheetGroup(
      group({ stdHours: 10, otHours: 2, isHoliday: true }),
      { rate: RATE, hint: undefined, holidayMultiplier: 2 },
    );
    // Holiday: (10 + 2) hrs all at base 35, doubled = 840
    expect(line.total).toBe(840);
    expect(line.rule).toBe("Holiday timesheet actuals");
  });
});

describe("priceTimesheetGroup — day mode", () => {
  const dayHint: QuoteRateHint = { rateMode: "day", baseDay: 350, baseHourly: 35 };

  it("bills the day rate with no overflow when workers are under the floor", () => {
    const { line } = priceTimesheetGroup(
      group({
        stdHours: 18, crewCount: 2,
        workerTotalHours: new Map([["w1", 9], ["w2", 9]]),
      }),
      { rate: RATE, hint: dayHint },
    );
    expect(line.rateMode).toBe("day");
    expect(line.hours).toBe(0);            // day mode: hours field unused
    expect(line.otHours).toBe(0);
    expect(line.total).toBe(700);          // 2 * 350
    expect(line.rule).toBe("Day rate (floor 10hr) + hourly overflow per quote");
  });

  it("bills per-worker overflow at hourly with no premium", () => {
    // w1 works 13 (3 over), w2 works 10 (0 over) -> 3 overflow hours.
    const { line } = priceTimesheetGroup(
      group({
        stdHours: 23, crewCount: 2,
        workerTotalHours: new Map([["w1", 13], ["w2", 10]]),
      }),
      { rate: RATE, hint: dayHint },
    );
    expect(line.otHours).toBe(3);
    expect(line.otRate).toBe(35);          // hourly, NOT the 52.50 OT rate
    expect(line.total).toBe(700 + 105);
  });

  it("does not net one worker's short day against another's overtime", () => {
    // w1 13 (3 over), w2 7 (under) -> still 3 overflow, not 0.
    const { line } = priceTimesheetGroup(
      group({
        stdHours: 20, crewCount: 2,
        workerTotalHours: new Map([["w1", 13], ["w2", 7]]),
      }),
      { rate: RATE, hint: dayHint },
    );
    expect(line.otHours).toBe(3);
  });

  it("ignores day mode when the quote hint has no day rate", () => {
    const { line } = priceTimesheetGroup(
      group({ stdHours: 10 }),
      { rate: RATE, hint: { rateMode: "day", baseDay: 0, baseHourly: 35 } },
    );
    expect(line.rateMode).toBe("hourly");
  });

  it("labels the holiday day-rate rule and doubles day + overflow", () => {
    const { line } = priceTimesheetGroup(
      group({
        stdHours: 13, crewCount: 1, isHoliday: true,
        workerTotalHours: new Map([["w1", 13]]),
      }),
      { rate: RATE, hint: dayHint, holidayMultiplier: 2 },
    );
    // (350 + 3*35) * 2 = 910
    expect(line.total).toBe(910);
    expect(line.rule).toBe("Holiday day rate (floor 10hr) + hourly overflow");
  });

  // ── Floor derivation ──────────────────────────────────────────────────────
  // The per-worker floor is NOT stored: it's round(baseDay / baseHourly).
  // For Connor's CCMF card every position divides evenly (350/35, 380/38,
  // 500/50) so the floor is exactly 10. These tests pin what happens when a
  // rate card does not divide evenly — the floor becomes a rounded value
  // nobody explicitly chose. Tracked as backlog #36 (store the floor vs. warn
  // on non-integer ratios) pending John's decision; behavior here is
  // documented, not endorsed.
  it("derives the floor from the day/hourly ratio", () => {
    const { line } = priceTimesheetGroup(
      group({ stdHours: 12, crewCount: 1, workerTotalHours: new Map([["w1", 12]]) }),
      { rate: RATE, hint: { rateMode: "day", baseDay: 400, baseHourly: 50 } },
    );
    // 400/50 = 8 -> 4 overflow hours at 50
    expect(line.otHours).toBe(4);
    expect(line.rule).toContain("floor 8hr");
  });

  it("rounds a non-integer ratio, shifting the overflow boundary", () => {
    // 400/37.50 = 10.67 -> rounds to 11, so a 12-hour day yields 1 overflow
    // hour instead of the 2 an operator reading "10 hour day" would expect.
    const { line } = priceTimesheetGroup(
      group({ stdHours: 12, crewCount: 1, workerTotalHours: new Map([["w1", 12]]) }),
      { rate: RATE, hint: { rateMode: "day", baseDay: 400, baseHourly: 37.5 } },
    );
    expect(line.rule).toContain("floor 11hr");
    expect(line.otHours).toBe(1);
  });

  it("falls back to a floor of 10 when no hourly rate is available", () => {
    const { line } = priceTimesheetGroup(
      group({ stdHours: 12, crewCount: 1, workerTotalHours: new Map([["w1", 12]]) }),
      {
        rate: { hourly: 0, otRate: 0, dtRate: 0 },
        hint: { rateMode: "day", baseDay: 350, baseHourly: 0 },
      },
    );
    expect(line.rule).toContain("floor 10hr");
  });

  it("uses the rate card hourly for overflow when the quote hint lacks one", () => {
    const { line } = priceTimesheetGroup(
      group({ stdHours: 13, crewCount: 1, workerTotalHours: new Map([["w1", 13]]) }),
      { rate: RATE, hint: { rateMode: "day", baseDay: 350, baseHourly: 0 } },
    );
    expect(line.baseHourly).toBe(35);
    expect(line.total).toBe(350 + 3 * 35);
  });
});
