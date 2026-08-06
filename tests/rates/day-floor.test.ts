import { describe, it, expect } from "vitest";
import {
  deriveDayFloor,
  dayFloorIsExact,
  suggestedDayRate,
  DEFAULT_DAY_FLOOR_HOURS,
} from "@/lib/rates/day-floor";

describe("deriveDayFloor", () => {
  it("returns the exact ratio when the rates divide evenly", () => {
    expect(deriveDayFloor(350, 35)).toBe(10);
    expect(deriveDayFloor(380, 38)).toBe(10);
    expect(deriveDayFloor(500, 50)).toBe(10);
    expect(deriveDayFloor(400, 50)).toBe(8);
  });

  it("rounds a non-integer ratio", () => {
    expect(deriveDayFloor(440, 43)).toBe(10);      // 10.23 -> 10
    expect(deriveDayFloor(400, 37.5)).toBe(11);    // 10.67 -> 11
    expect(deriveDayFloor(601, 60)).toBe(10);      // 10.02 -> 10
  });

  it("falls back to the default when there is no hourly rate", () => {
    expect(DEFAULT_DAY_FLOOR_HOURS).toBe(10);
    expect(deriveDayFloor(350, 0)).toBe(10);
    expect(deriveDayFloor(350, -5)).toBe(10);
  });

  it("derives a floor of zero when the day rate is far below the hourly", () => {
    // Real prod row (Actual / BUYOUT: day 15, hourly 34). Documents the
    // sharp edge — every logged hour would become overflow. BUYOUT is an
    // expense pass-through with no timesheets, so this never fires today.
    expect(deriveDayFloor(15, 34)).toBe(0);
  });
});

describe("dayFloorIsExact", () => {
  it("is true for evenly dividing rates", () => {
    expect(dayFloorIsExact(350, 35)).toBe(true);
    expect(dayFloorIsExact(400, 50)).toBe(true);
  });

  it("is false when the ratio needs rounding", () => {
    expect(dayFloorIsExact(440, 43)).toBe(false);
    expect(dayFloorIsExact(400, 37.5)).toBe(false);
    expect(dayFloorIsExact(601, 60)).toBe(false);
    expect(dayFloorIsExact(15, 34)).toBe(false);
  });

  it("treats non-day-rate rows as exact — there is no floor to be wrong about", () => {
    expect(dayFloorIsExact(0, 35)).toBe(true);
    expect(dayFloorIsExact(350, 0)).toBe(true);
    expect(dayFloorIsExact(0, 0)).toBe(true);
  });

  it("tolerates float representation error", () => {
    // 0.1 * 3 style dust must not be reported as an uneven ratio.
    expect(dayFloorIsExact(35 * 10, 35)).toBe(true);
    expect(dayFloorIsExact(37.5 * 8, 37.5)).toBe(true);
  });
});

describe("suggestedDayRate", () => {
  it("suggests the day rate that makes the floor exact", () => {
    // 440/43 rounds to a floor of 10, so 10 x 43 = 430 divides evenly.
    expect(suggestedDayRate(440, 43)).toBe(430);
    // 400/37.50 rounds to 11, so 11 x 37.50 = 412.50.
    expect(suggestedDayRate(400, 37.5)).toBe(412.5);
  });

  it("leaves an already-exact rate unchanged", () => {
    expect(suggestedDayRate(350, 35)).toBe(350);
  });

  it("returns zero when there is no hourly rate to work from", () => {
    expect(suggestedDayRate(350, 0)).toBe(0);
  });
});
