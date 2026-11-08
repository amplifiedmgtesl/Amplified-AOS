/**
 * lib/paychex/fill.ts — what AOS can fill in on a Paychex worker (John, 2026-11-07).
 *
 * Pure planning, no network: given what AOS knows and what Paychex already
 * has, list the writes that fill BLANKS only. Nothing Paychex already holds
 * is ever changed. lib/paychex/api.ts (fillPaychexWorker) does the writes.
 *
 * Tested on the "Just Test" worker 2026-11-08 and against the Paychex spec:
 *  - a phone goes in as type PHONE / usageType PERSONAL. Paychex accepts
 *    MOBILE_PHONE only as BUSINESS, and John chose personal phone.
 *  - a mailing address goes in as STREET_ADDRESS / MAILING_ADDRESS and
 *    needs street, city, state and zip, so a partial address is skipped.
 *  - hire date, Non-exempt, location and organization are set with a PATCH
 *    (tested 10/30). Work state and the final Finish can't be set by the
 *    API; those stay in Flex.
 */

/** The values Connor uses when he completes a hire in Flex (10/30). */
export const PAYCHEX_DEFAULTS = {
  exemptionType: "NON_EXEMPT",
  locationId: "1080043898537244",
  organizationId: "1040050020666262", // "2 Production Team"
} as const;

export type AosFill = {
  phone: string;
  street: string;
  city: string;
  stateCode: string;
  zip: string;
  /** Earlier of the day they applied and their first work day (YYYY-MM-DD). */
  hireDate: string | null;
};

export type PaychexHas = {
  status: string;          // ACTIVE, IN_PROGRESS, …
  hasPhone: boolean;       // any PHONE or MOBILE_PHONE
  hasAddress: boolean;     // any STREET_ADDRESS
  hireDate: string | null;
  exemptionType: string | null;
  locationId: string | null;
  organizationId: string | null;
};

export type FillField = "phone" | "address" | "hireDate" | "exemption" | "location" | "organization";

export type FillPlan = {
  phone: Record<string, string> | null;
  address: Record<string, string> | null;
  patch: Record<string, unknown> | null;
  /** Fields Paychex is missing that AOS has, in plain words. */
  fills: FillField[];
  /** Fields Paychex is missing that AOS can't fill. */
  missing: FillField[];
};

const digits = (s: string) => (s ?? "").replace(/\D/g, "");

/** US 10-digit number, or null. Drops a leading 1. */
export function splitPhone(raw: string): { dialArea: string; dialNumber: string } | null {
  let d = digits(raw);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  return { dialArea: d.slice(0, 3), dialNumber: d.slice(3) };
}

/** A whole US mailing address, or null if any part is missing. */
export function mailingAddress(a: AosFill): Record<string, string> | null {
  const street = (a.street ?? "").trim();
  const city = (a.city ?? "").trim();
  const state = (a.stateCode ?? "").trim().toUpperCase();
  const zip = digits(a.zip ?? "");
  if (!street || !city || !/^[A-Z]{2}$/.test(state) || (zip.length !== 5 && zip.length !== 9)) return null;
  return {
    type: "STREET_ADDRESS", usageType: "MAILING_ADDRESS",
    streetLineOne: street, city, countrySubdivisionCode: state,
    postalCode: zip.length === 9 ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip,
    countryCode: "US",
  };
}

/** John's rule (10/30): the earlier of the applied date and the first work day. */
export function hireDateFor(appliedAt: string | null, firstWorkDay: string | null): string | null {
  const ds = [appliedAt, firstWorkDay].filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10));
  return ds.length ? ds.sort()[0] : null;
}

export function planFill(aos: AosFill, px: PaychexHas): FillPlan {
  const fills: FillField[] = [];
  const missing: FillField[] = [];

  let phone: FillPlan["phone"] = null;
  if (!px.hasPhone) {
    const p = splitPhone(aos.phone);
    if (p) { phone = { type: "PHONE", usageType: "PERSONAL", dialCountry: "1", ...p }; fills.push("phone"); }
    else missing.push("phone");
  }

  let address: FillPlan["address"] = null;
  if (!px.hasAddress) {
    address = mailingAddress(aos);
    (address ? fills : missing).push("address");
  }

  // Admin fields only matter until the hire is finished; an active worker
  // already has them, and those are Connor's to change in Flex.
  const patch: Record<string, unknown> = {};
  if (px.status !== "ACTIVE") {
    if (!px.hireDate) {
      if (aos.hireDate) { patch.hireDate = `${aos.hireDate}T00:00:00Z`; fills.push("hireDate"); }
      else missing.push("hireDate");
    }
    if (!px.exemptionType) { patch.exemptionType = PAYCHEX_DEFAULTS.exemptionType; fills.push("exemption"); }
    if (!px.locationId) { patch.locationId = PAYCHEX_DEFAULTS.locationId; fills.push("location"); }
    if (!px.organizationId) { patch.organization = { organizationId: PAYCHEX_DEFAULTS.organizationId }; fills.push("organization"); }
  }

  return { phone, address, patch: Object.keys(patch).length ? patch : null, fills, missing };
}

export const FILL_LABEL: Record<FillField, string> = {
  phone: "phone", address: "mailing address", hireDate: "hire date",
  exemption: "Non-exempt", location: "location", organization: "Production Team",
};
