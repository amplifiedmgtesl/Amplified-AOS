import { describe, it, expect } from "vitest";
import { promoteWorkedStatus, blankTimeEntry } from "@/lib/store/timekeeping";

const row = (status: string, times: Partial<Record<"timeIn1" | "timeOut1" | "timeIn2" | "timeOut2", string>> = {}) =>
  ({ ...blankTimeEntry("t1"), status, ...times });

describe("promoteWorkedStatus", () => {
  it("leaves an unworked planned row planned", () => {
    expect(promoteWorkedStatus(row("planned")).status).toBe("planned");
  });
  it("promotes planned to submitted once any time is recorded", () => {
    expect(promoteWorkedStatus(row("planned", { timeIn1: "08:00" })).status).toBe("submitted");
    expect(promoteWorkedStatus(row("planned", { timeOut2: "02:00" })).status).toBe("submitted");
  });
  it("lifts a No Show to submitted when they turn up and time is recorded (#92)", () => {
    expect(promoteWorkedStatus(row("no_show")).status).toBe("no_show");
    expect(promoteWorkedStatus(row("no_show", { timeIn2: "21:10" })).status).toBe("submitted");
  });
  it("never touches approved, rejected or submitted rows", () => {
    for (const s of ["approved", "rejected", "submitted"]) {
      expect(promoteWorkedStatus(row(s, { timeIn1: "08:00" })).status).toBe(s);
    }
  });
});

describe("blankTimeEntry (#57/#73)", () => {
  it("invents no position and no bill rates", () => {
    const e = blankTimeEntry("x");
    expect(e.position).toBe("");
    expect(e.positionId).toBeUndefined();
    expect([e.billStdRate, e.billOtRate, e.billDtRate]).toEqual([0, 0, 0]);
  });
});
