import { describe, it, expect } from "vitest";
import { computeLineTotal, isDayModeLine, HOLIDAY_MULTIPLIER } from "@/lib/rates/line-calc";

// computeLineTotal produces the dollar amount on every quote line and every
// invoice line in the system. These tests pin the arithmetic, not the intent —
// if a rule genuinely changes, the expected numbers here are meant to be
// updated deliberately rather than silently drift.

describe("isDayModeLine", () => {
  it("honors an explicit rateMode", () => {
    expect(isDayModeLine({ rateMode: "day", baseDay: 0, hours: 8 } as any)).toBe(true);
    expect(isDayModeLine({ rateMode: "hourly", baseDay: 350, hours: 0 } as any)).toBe(false);
  });

  it("infers day mode for legacy lines with a day rate and no hours", () => {
    expect(isDayModeLine({ baseDay: 350, hours: 0 } as any)).toBe(true);
  });

  it("infers hourly for legacy lines carrying hours", () => {
    expect(isDayModeLine({ baseDay: 350, hours: 8 } as any)).toBe(false);
    expect(isDayModeLine({ baseDay: 0, hours: 0 } as any)).toBe(false);
  });
});

describe("computeLineTotal — hourly mode", () => {
  it("bills straight time at the base hourly rate", () => {
    // 3 crew is irrelevant in hourly mode: hours are already person-hours.
    expect(computeLineTotal({
      rateMode: "hourly", crewCount: 3, hours: 10, baseHourly: 35,
    } as any)).toBe(350);
  });

  it("bills OT and DT from their own rate fields", () => {
    // 10 ST @35 = 350, 2 OT @52.50 = 105, 1 DT @70 = 70
    expect(computeLineTotal({
      rateMode: "hourly", hours: 10, otHours: 2, dtHours: 1,
      baseHourly: 35, otRate: 52.5, dtRate: 70,
    } as any)).toBe(525);
  });

  it("adds travel on top, untouched by any multiplier", () => {
    expect(computeLineTotal({
      rateMode: "hourly", hours: 8, baseHourly: 35, travel: 45,
    } as any)).toBe(325);
  });

  it("treats missing numeric fields as zero rather than NaN", () => {
    expect(computeLineTotal({ rateMode: "hourly" } as any)).toBe(0);
  });

  it("rounds to cents", () => {
    // 7.33 * 35.55 = 260.5815 -> 260.58
    expect(computeLineTotal({
      rateMode: "hourly", hours: 7.33, baseHourly: 35.55,
    } as any)).toBe(260.58);
  });
});

describe("computeLineTotal — day mode", () => {
  it("bills day rate per crew member, ignoring the hours field", () => {
    expect(computeLineTotal({
      rateMode: "day", crewCount: 4, baseDay: 350, hours: 99,
    } as any)).toBe(1400);
  });

  it("falls back to qty when crewCount is absent", () => {
    expect(computeLineTotal({
      rateMode: "day", qty: 2, baseDay: 350,
    } as any)).toBe(700);
  });

  it("defaults to a crew of 1 when neither crewCount nor qty is set", () => {
    expect(computeLineTotal({ rateMode: "day", baseDay: 350 } as any)).toBe(350);
  });

  it("bills overflow hours through the OT bucket", () => {
    // 2 crew * 350 = 700, plus 3 overflow hrs @35 (no premium) = 105
    expect(computeLineTotal({
      rateMode: "day", crewCount: 2, baseDay: 350, otHours: 3, otRate: 35,
    } as any)).toBe(805);
  });
});

describe("computeLineTotal — holiday", () => {
  it("defaults to the 2.0x fallback multiplier", () => {
    expect(HOLIDAY_MULTIPLIER).toBe(2.0);
    expect(computeLineTotal(
      { rateMode: "hourly", hours: 10, baseHourly: 35 } as any,
      { dayIsHoliday: true },
    )).toBe(700);
  });

  it("collapses OT and DT to base hourly, then applies the multiplier", () => {
    // The documented rule: 10 ST + 2 OT + 3 DT on a holiday bills as
    // 15 hrs * baseHourly * H — the otRate/dtRate fields are NOT used.
    const line = {
      rateMode: "hourly", hours: 10, otHours: 2, dtHours: 3,
      baseHourly: 35, otRate: 52.5, dtRate: 70,
    } as any;
    expect(computeLineTotal(line, { dayIsHoliday: true, holidayMultiplier: 2 }))
      .toBe(15 * 35 * 2);
    // Sanity: the non-holiday total differs, so the branch really is engaged.
    expect(computeLineTotal(line)).toBe(350 + 105 + 210);
  });

  it("uses the per-document multiplier when supplied", () => {
    expect(computeLineTotal(
      { rateMode: "hourly", hours: 10, baseHourly: 35 } as any,
      { dayIsHoliday: true, holidayMultiplier: 1.5 },
    )).toBe(525);
  });

  it("multiplies the day rate and the overflow, but not travel", () => {
    // (2*350 + 3*35) * 2 = 1610, then + 100 travel unmultiplied
    expect(computeLineTotal(
      {
        rateMode: "day", crewCount: 2, baseDay: 350,
        otHours: 3, baseHourly: 35, travel: 100,
      } as any,
      { dayIsHoliday: true, holidayMultiplier: 2 },
    )).toBe(1710);
  });

  it("does not engage the holiday branch when the flag is absent", () => {
    expect(computeLineTotal(
      { rateMode: "hourly", hours: 10, baseHourly: 35 } as any,
      { holidayMultiplier: 2 },
    )).toBe(350);
  });
});
