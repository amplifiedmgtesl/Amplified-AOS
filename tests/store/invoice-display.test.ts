import { describe, it, expect } from "vitest";
import { invoiceHolidayLookup, type InvoiceDay } from "@/lib/storage/invoice-days";
import { displayStatus as invoiceDisplayStatus } from "@/lib/store/invoices";
import { displayStatus as quoteDisplayStatus } from "@/lib/store/quotes";

function day(invoiceDate: string, isHoliday: boolean): InvoiceDay {
  return { id: `d-${invoiceDate}`, invoiceId: "inv-1", invoiceDate, isHoliday };
}

// invoiceHolidayLookup is small but sits directly in the money path: the map it
// builds is what tells computeLineTotal whether to apply the holiday
// multiplier. A wrong or missing key silently bills a holiday at base rate.
describe("invoiceHolidayLookup", () => {
  it("keys holiday flags by date", () => {
    const m = invoiceHolidayLookup([
      day("2026-07-04", true),
      day("2026-07-05", false),
    ]);
    expect(m.get("2026-07-04")).toBe(true);
    expect(m.get("2026-07-05")).toBe(false);
  });

  it("returns an empty map for no days", () => {
    expect(invoiceHolidayLookup([]).size).toBe(0);
  });

  it("reports undefined — not false — for a date it has never seen", () => {
    // Callers treat a miss as "not a holiday", but the distinction matters:
    // undefined means the day was never snapshotted, false means it was and
    // is not a holiday.
    const m = invoiceHolidayLookup([day("2026-07-04", true)]);
    expect(m.get("2026-08-01")).toBeUndefined();
    expect(m.has("2026-08-01")).toBe(false);
  });

  it("lets a later duplicate date win", () => {
    const m = invoiceHolidayLookup([
      day("2026-07-04", false),
      day("2026-07-04", true),
    ]);
    expect(m.get("2026-07-04")).toBe(true);
  });
});

describe("displayStatus — invoices", () => {
  it("labels a draft regardless of any status value", () => {
    expect(invoiceDisplayStatus({ isDraft: true, status: "void" } as any)).toBe("Draft");
  });

  it("labels an issued invoice with no status", () => {
    expect(invoiceDisplayStatus({ isDraft: false, status: null } as any)).toBe("Issued");
  });

  it("capitalizes a set status", () => {
    expect(invoiceDisplayStatus({ isDraft: false, status: "paid" } as any)).toBe("Paid");
    expect(invoiceDisplayStatus({ isDraft: false, status: "void" } as any)).toBe("Void");
    expect(invoiceDisplayStatus({ isDraft: false, status: "superseded" } as any))
      .toBe("Superseded");
  });
});

describe("displayStatus — quotes", () => {
  it("labels a draft regardless of any status value", () => {
    expect(quoteDisplayStatus({ isDraft: true, status: "signed" } as any)).toBe("Draft");
  });

  it("labels an issued quote with no status", () => {
    expect(quoteDisplayStatus({ isDraft: false, status: null } as any)).toBe("Issued");
  });

  it("capitalizes a set status", () => {
    expect(quoteDisplayStatus({ isDraft: false, status: "signed" } as any)).toBe("Signed");
    expect(quoteDisplayStatus({ isDraft: false, status: "superseded" } as any))
      .toBe("Superseded");
  });
});
