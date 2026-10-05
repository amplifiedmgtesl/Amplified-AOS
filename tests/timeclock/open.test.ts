import { describe, expect, it } from "vitest";
import { canUseTimeclock, timeclockHome, timeclockUrl } from "@/lib/timeclock/open";

describe("Time Clock entry points", () => {
  it("only crew leaders and admins may use the kiosk", () => {
    expect(canUseTimeclock("crew_leader")).toBe(true);
    expect(canUseTimeclock("admin")).toBe(true);
    for (const r of ["coordinator", "payroll", "", null, undefined]) {
      expect(canUseTimeclock(r)).toBe(false);
    }
  });

  it("opens on a job when given one", () => {
    expect(timeclockUrl()).toBe("/timeclock");
    expect(timeclockUrl(null)).toBe("/timeclock");
    expect(timeclockUrl("jobreq-1 &x")).toBe("/timeclock?job=jobreq-1%20%26x");
  });

  it("Exit falls back to the user's own AOS home", () => {
    expect(timeclockHome("crew_leader")).toBe("/lead/timekeeping");
    expect(timeclockHome("admin")).toBe("/timekeeping");
  });
});
