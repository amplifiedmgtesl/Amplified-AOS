import { describe, it, expect } from "vitest";
import { roundInstantToTimeString } from "@/lib/timeclock/time";

const at = (h: number, m: number, s: number) => new Date(2026, 8, 13, h, m, s);

describe("roundInstantToTimeString (#97)", () => {
  it("rounds to the nearest 5 minutes using seconds", () => {
    expect(roundInstantToTimeString(at(14, 52, 58))).toBe("14:55"); // was 14:50
    expect(roundInstantToTimeString(at(14, 52, 29))).toBe("14:50");
    expect(roundInstantToTimeString(at(14, 49, 15))).toBe("14:50");
    expect(roundInstantToTimeString(at(23, 25, 30))).toBe("23:25");
  });
  it("wraps past midnight", () => {
    expect(roundInstantToTimeString(at(23, 57, 40))).toBe("00:00");
  });
});
