import { describe, it, expect } from "vitest";
import { hireDateFor, mailingAddress, planFill, splitPhone, PAYCHEX_DEFAULTS, type AosFill, type PaychexHas } from "@/lib/paychex/fill";

const aos: AosFill = { phone: "(913) 555-0142", street: "5555 Main St", city: "Metairie", stateCode: "la", zip: "70001", hireDate: "2026-10-12" };
const blank: PaychexHas = { status: "IN_PROGRESS", hasPhone: false, hasAddress: false, hireDate: null, exemptionType: null, locationId: null, organizationId: null };

describe("splitPhone", () => {
  it("splits a US number and drops a leading 1", () => {
    expect(splitPhone("(913) 555-0142")).toEqual({ dialArea: "913", dialNumber: "5550142" });
    expect(splitPhone("+1 913.555.0142")).toEqual({ dialArea: "913", dialNumber: "5550142" });
  });
  it("rejects anything that isn't 10 digits", () => {
    expect(splitPhone("555-0142")).toBeNull();
    expect(splitPhone("")).toBeNull();
  });
});

describe("mailingAddress", () => {
  it("needs street, city, state and zip", () => {
    expect(mailingAddress({ ...aos, zip: "" })).toBeNull();
    expect(mailingAddress({ ...aos, city: " " })).toBeNull();
    expect(mailingAddress({ ...aos, stateCode: "Louisiana" })).toBeNull();
  });
  it("upper-cases the state and formats a 9-digit zip", () => {
    const a = mailingAddress({ ...aos, zip: "700011234" })!;
    expect(a.countrySubdivisionCode).toBe("LA");
    expect(a.postalCode).toBe("70001-1234");
    expect(a.usageType).toBe("MAILING_ADDRESS");
  });
});

describe("hireDateFor", () => {
  it("is the earlier of applied and first work day", () => {
    expect(hireDateFor("2026-10-19", "2026-10-16")).toBe("2026-10-16");
    expect(hireDateFor("2026-10-12T12:00:00Z", "2026-10-16")).toBe("2026-10-12");
    expect(hireDateFor(null, "2026-10-16")).toBe("2026-10-16");
    expect(hireDateFor(null, null)).toBeNull();
  });
});

describe("planFill", () => {
  it("fills every blank on an in-progress worker", () => {
    const p = planFill(aos, blank);
    expect(p.phone).toMatchObject({ type: "PHONE", usageType: "PERSONAL", dialArea: "913" });
    expect(p.address).not.toBeNull();
    expect(p.patch).toEqual({
      hireDate: "2026-10-12T00:00:00Z", exemptionType: "NON_EXEMPT",
      locationId: PAYCHEX_DEFAULTS.locationId, organization: { organizationId: PAYCHEX_DEFAULTS.organizationId },
    });
    expect(p.missing).toEqual([]);
  });
  it("never touches what Paychex already has", () => {
    const p = planFill(aos, { ...blank, hasPhone: true, hasAddress: true, hireDate: "2026-10-30", exemptionType: "EXEMPT", locationId: "x", organizationId: "y" });
    expect(p).toMatchObject({ phone: null, address: null, patch: null, fills: [] });
  });
  it("leaves hire details alone on an active worker", () => {
    const p = planFill(aos, { ...blank, status: "ACTIVE" });
    expect(p.patch).toBeNull();
    expect(p.fills).toEqual(["phone", "address"]);
  });
  it("reports what AOS can't fill", () => {
    const p = planFill({ ...aos, phone: "", zip: "", hireDate: null }, blank);
    expect(p.missing).toEqual(["phone", "address", "hireDate"]);
    expect(p.patch).not.toHaveProperty("hireDate");
  });
});
