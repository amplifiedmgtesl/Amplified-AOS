import { describe, it, expect } from "vitest";
import {
  computeDayHourSplit,
  triggerToKind,
  parseOtTriggerRule,
  triggerLabel,
} from "@/lib/rates/ot-trigger";

describe("triggerToKind", () => {
  it("maps the sentinel values", () => {
    expect(triggerToKind("none")).toEqual({ kind: "none" });
    expect(triggerToKind("weekly40")).toEqual({ kind: "weekly" });
    expect(triggerToKind("10")).toEqual({ kind: "daily", hours: 10 });
    expect(triggerToKind("8")).toEqual({ kind: "daily", hours: 8 });
  });
});

describe("triggerLabel", () => {
  it("renders a bare threshold, making no claim about DT", () => {
    expect(triggerLabel("none")).toBe("None");
    expect(triggerLabel("weekly40")).toBe("After 40 / wk");
    expect(triggerLabel("12")).toBe("After 12");
  });
});

describe("parseOtTriggerRule", () => {
  it("recognizes the no-OT and weekly phrasings", () => {
    expect(parseOtTriggerRule("No OT")).toEqual({ kind: "none" });
    expect(parseOtTriggerRule("OT after 40 / week")).toEqual({ kind: "weekly" });
  });

  it("extracts a daily threshold", () => {
    expect(parseOtTriggerRule("OT after 10 / DT after 15"))
      .toEqual({ kind: "daily", hours: 10 });
  });

  it("falls back to 10 for unrecognized text", () => {
    // This fallback is why parsing rules out of free text is fragile: an
    // unparseable rule silently becomes "OT after 10" rather than erroring.
    expect(parseOtTriggerRule("")).toEqual({ kind: "daily", hours: 10 });
    expect(parseOtTriggerRule("see terms")).toEqual({ kind: "daily", hours: 10 });
  });
});

describe("computeDayHourSplit", () => {
  it("puts everything in straight time when there is no OT trigger", () => {
    expect(computeDayHourSplit(14, { kind: "none" }))
      .toEqual({ st: 14, ot: 0, dt: 0 });
  });

  it("puts everything in straight time for weekly triggers", () => {
    // Weekly OT is settled at the week level, not per day, so the daily
    // split intentionally leaves all hours as ST here.
    expect(computeDayHourSplit(14, { kind: "weekly" }))
      .toEqual({ st: 14, ot: 0, dt: 0 });
  });

  it("leaves hours at or under the threshold entirely in ST", () => {
    expect(computeDayHourSplit(8, { kind: "daily", hours: 10 }))
      .toEqual({ st: 8, ot: 0, dt: 0 });
    expect(computeDayHourSplit(10, { kind: "daily", hours: 10 }))
      .toEqual({ st: 10, ot: 0, dt: 0 });
  });

  it("splits hours past the threshold into OT", () => {
    expect(computeDayHourSplit(12, { kind: "daily", hours: 10 }))
      .toEqual({ st: 10, ot: 2, dt: 0 });
  });

  it("clamps to zero for a zero-hour day", () => {
    expect(computeDayHourSplit(0, { kind: "daily", hours: 10 }))
      .toEqual({ st: 0, ot: 0, dt: 0 });
  });

  it("treats negative hours as zero", () => {
    expect(computeDayHourSplit(-5, { kind: "daily", hours: 10 }))
      .toEqual({ st: 0, ot: 0, dt: 0 });
  });

  // ── The hardcoded DT boundary ────────────────────────────────────────────
  // These tests document current behavior, not desired behavior.
  // computeDayHourSplit fixes double-time at 15 hours regardless of the rate
  // card's dt_after column. The live billing path (lib/store/timekeeping.ts)
  // honors billDtAfter instead, so the two disagree — but this function is
  // reached ONLY from components/shared/job-costing.tsx, and job costing is a
  // known-outdated module slated for a full rework (backlog #25). Not a live
  // billing issue; do not "fix" it here ahead of that rework.
  it("starts DT at a hardcoded 15 hours, ignoring any configured dt_after", () => {
    expect(computeDayHourSplit(17, { kind: "daily", hours: 10 }))
      .toEqual({ st: 10, ot: 5, dt: 2 });
  });

  it("caps the OT bucket at 15 hours even for a very long day", () => {
    // 24 hrs: 10 ST, OT capped at 15-10 = 5, remaining 9 to DT.
    expect(computeDayHourSplit(24, { kind: "daily", hours: 10 }))
      .toEqual({ st: 10, ot: 5, dt: 9 });
  });

  it("produces a zero OT window when the threshold is at or past 15", () => {
    // A rate card with OT after 15 gets no OT bucket at all — everything
    // past 15 goes straight to DT. Worth knowing before someone configures it.
    expect(computeDayHourSplit(18, { kind: "daily", hours: 15 }))
      .toEqual({ st: 15, ot: 0, dt: 3 });
  });

  it("conserves total hours across the three buckets", () => {
    for (const total of [0, 7.5, 10, 12.25, 15, 16, 23]) {
      const s = computeDayHourSplit(total, { kind: "daily", hours: 10 });
      expect(s.st + s.ot + s.dt).toBeCloseTo(total, 10);
    }
  });
});
