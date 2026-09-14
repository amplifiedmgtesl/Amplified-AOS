import { describe, it, expect, vi } from "vitest";

// The module imports the Supabase client at load; the pure helpers under test
// never touch it, so stub it out rather than require env configuration.
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { formatAuditLine, appendNoteLine } from "@/lib/jobs/job-notes-log";

describe("formatAuditLine", () => {
  it("stamps local date, 12-hour time and name", () => {
    const at = new Date(2026, 8, 13, 15, 40);
    expect(formatAuditLine(at, "John O'Brien", "Copied planned → actual — 9/13, 8 rows"))
      .toBe("[2026-09-13 3:40 PM · John O'Brien] Copied planned → actual — 9/13, 8 rows");
  });
  it("handles midnight and noon", () => {
    expect(formatAuditLine(new Date(2026, 8, 14, 0, 5), "A", "x")).toBe("[2026-09-14 12:05 AM · A] x");
    expect(formatAuditLine(new Date(2026, 8, 14, 12, 0), "A", "x")).toBe("[2026-09-14 12:00 PM · A] x");
  });
  it("keeps the entry on one line and never leaves the name blank", () => {
    expect(formatAuditLine(new Date(2026, 0, 2, 9, 0), "  ", "kiosk\ndown\n  confirmed"))
      .toBe("[2026-01-02 9:00 AM · unknown user] kiosk down confirmed");
  });
});

describe("appendNoteLine", () => {
  it("starts empty notes with the line", () => {
    expect(appendNoteLine("", "L1")).toBe("L1");
    expect(appendNoteLine(null, "L1")).toBe("L1");
  });
  it("adds one line under existing notes, trimming trailing blank lines", () => {
    expect(appendNoteLine("Seeded for testing.\n\n", "L1")).toBe("Seeded for testing.\nL1");
    expect(appendNoteLine("a\nb", "c")).toBe("a\nb\nc");
  });
});
