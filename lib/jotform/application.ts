// Website applicants into the Employee list (backlog #121, 2026-10-21).
//
// Pure: turns one JotForm "Employee Application Form" submission (webhook
// post or a row of the CSV export) into what should happen to the Employee
// list. No network, no database: lib/jotform/server.ts does the writes.
//
// Rules (docs/jotform-applicants-plan.md):
//   • find the person first, because a crew lead may have added them before
//     they applied: email → phone (first name must fit, families share
//     phones) → same name, only if one AOS record has it and its email and
//     phone don't disagree;
//   • found one: fill blanks only, never overwrite. Differences are kept in
//     application_contact for the Onboarding page;
//   • found several: change nothing, log it (they're already duplicates the
//     Onboarding page flags);
//   • found none: new Contractor, source website-application;
//   • junk is skipped and logged.

import { digits10, formatPhone, nameKey } from "@/lib/paychex/sync-plan";
import { similarName } from "@/lib/onboarding/plan";

export const EMPLOYEE_APPLICATION_FORM_ID = "260385023196052";
export const APPLICATION_SOURCE = "website-application";

export type AppAddress = {
  line1: string; line2: string; city: string; state: string; zip: string; country: string;
  /** One-line version: what the CSV export gives, or line1/city/state/zip joined. */
  text: string;
};

export type Application = {
  submissionId: string;
  /** YYYY-MM-DD. The CSV only has the day; the webhook uses the day it arrived. */
  submittedOn: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: AppAddress;
  /** true when the address came split into parts (webhook). The CSV joins
   *  street and city with a space, so only state and zip are trusted. */
  addressStructured: boolean;
  position: string;
  sms: boolean | null;
};

// ── Reading a submission ────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

/** "chandler escota" → "Chandler Escota". Mixed case is left as typed. */
export function tidyName(s: string): string {
  const t = str(s).replace(/\s+/g, " ");
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

const tidyState = (s: string) => (/^[a-z]{2}$/i.test(str(s)) ? str(s).toUpperCase() : str(s));
const tidyZip = (s: string) => str(s).match(/^\d{5}/)?.[0] ?? "";

function joinAddress(a: Omit<AppAddress, "text">): string {
  const street = [a.line1, a.line2].filter(Boolean).join(" ");
  return [street, a.city, a.state, a.zip].filter(Boolean).join(", ");
}

/** Find an answer in JotForm's rawRequest by question ID ("q3_email1" → 3). */
function answer(raw: Record<string, unknown>, qid: number): unknown {
  const k = Object.keys(raw).find((key) => key.startsWith(`q${qid}_`));
  return k ? raw[k] : undefined;
}

const smsAnswer = (v: unknown): boolean | null => {
  const s = str(v).toLowerCase();
  return s === "yes" ? true : s === "no" ? false : null;
};

/** The webhook's rawRequest (question IDs confirmed 2026-10-20: 2 name,
 *  3 email, 4 phone, 5 address, 6 position, 13 text opt-in). */
export function parseWebhook(raw: Record<string, unknown>, submissionId: string, receivedOn: string): Application {
  const name = (answer(raw, 2) ?? {}) as Record<string, unknown>;
  const phone = answer(raw, 4);
  const addr = (answer(raw, 5) ?? {}) as Record<string, unknown>;
  const parts = {
    line1: str(addr.addr_line1), line2: str(addr.addr_line2), city: tidyName(str(addr.city)),
    state: tidyState(str(addr.state)), zip: str(addr.postal), country: str(addr.country),
  };
  return {
    submissionId: str(submissionId),
    submittedOn: receivedOn,
    firstName: tidyName(str(name.first)),
    lastName: tidyName(str(name.last)),
    email: str(answer(raw, 3)).toLowerCase(),
    phone: str(typeof phone === "object" && phone ? (phone as Record<string, unknown>).full : phone),
    address: { ...parts, text: joinAddress(parts) },
    addressStructured: true,
    position: str(answer(raw, 6)),
    sms: smsAnswer(answer(raw, 13)),
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Oct 20, 2026" → "2026-10-20". */
export function csvDate(s: string): string {
  const m = str(s).match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/);
  if (!m) return "";
  const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  return mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}

const RESUME_COL = "Upload Your Resume (PDF, DOC, or DOCX)";
const SMS_COL = "By choosing Yes you agree to receive text messages from Amplified Event Solutions LLC.";

/** The CSV export has no submission ID column; the résumé link carries it
 *  (…/uploads/<user>/260385023196052/<submissionID>/<file>). */
export function submissionIdFromResume(url: string): string {
  return str(url).match(new RegExp(`/${EMPLOYEE_APPLICATION_FORM_ID}/(\\d+)/`))?.[1] ?? "";
}

/** One row of the CSV export. Full Name is one column: last word = last name. */
export function parseCsvRow(row: Record<string, string>): Application {
  const words = tidyName(row["Full Name"] ?? "").split(" ").filter(Boolean);
  const text = str(row["Address"]);
  const bits = text.split(",").map((x) => x.trim());
  const zip = bits.length >= 3 ? tidyZip(bits[bits.length - 1]) : "";
  const state = zip ? tidyState(bits[bits.length - 2]) : "";
  return {
    submissionId: submissionIdFromResume(row[RESUME_COL] ?? ""),
    submittedOn: csvDate(row["Submission Date"] ?? ""),
    firstName: words.slice(0, -1).join(" "),
    lastName: words.length > 1 ? words[words.length - 1] : words.join(" "),
    email: str(row["Email Address"]).toLowerCase(),
    phone: str(row["Phone Number"]),
    address: { line1: "", line2: "", city: "", state, zip, country: "", text },
    addressStructured: false,
    position: str(row["Position Applied For"]),
    sms: smsAnswer(row[SMS_COL]),
  };
}

/** Minimal CSV reader (quoted fields, embedded commas/newlines/quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}

// ── Junk ────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const TYPO_DOMAINS = new Set([
  "gamil.com", "gmial.com", "gmai.com", "gmal.com", "gnail.com", "gmail.co", "gmail.con", "gmaill.com",
  "yaho.com", "yahooo.com", "yahoo.co", "hotmial.com", "hotmal.com", "hotmail.co", "outlok.com",
  "iclod.com", "icloud.co", "icoud.com",
]);

/** Why this submission isn't loaded, or null. */
export function junkReason(a: Application): string | null {
  if (!a.submissionId) return "No submission ID";
  if (!EMAIL_RE.test(a.email)) return "No valid email";
  if (!digits10(a.phone) || a.phone.replace(/\D/g, "").length > 11) return "Phone isn't 10 digits";
  const full = `${a.firstName} ${a.lastName}`;
  if (/https?:|www\.|\.com\b|\d/i.test(full)) return "Link or digits in the name";
  if (!a.firstName || !a.lastName) return "One-word name";
  return null;
}

/** "gamil.com" and friends: loaded, but flagged in the log. */
export function emailTypo(email: string): string | null {
  const d = str(email).toLowerCase().split("@")[1] ?? "";
  return TYPO_DOMAINS.has(d) ? `Email domain looks misspelled (${d})` : null;
}

// ── Matching ────────────────────────────────────────────────────────────────

export type AppEmployee = {
  employeeKey: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  stateCode: string;
  zip: string;
  appliedAt: string | null;          // YYYY-MM-DD of the latest application
  submissionId: string | null;
};

export type Match =
  | { kind: "one"; employee: AppEmployee; reason: "email" | "phone" | "name" }
  | { kind: "several"; keys: string[]; reason: "email" | "phone" | "name" }
  | { kind: "none" };

const SUFFIX = /\b(jr|sr|ii|iii|iv)\b/i;
const suffixOf = (n: string) => (n.match(SUFFIX)?.[1] ?? "").toLowerCase();
const firstOf = (n: string) => nameKey(n).split(" ")[0] ?? "";
const fullName = (a: Application) => `${a.firstName} ${a.lastName}`.trim();
const lower = (s: string) => str(s).toLowerCase();

/** Same person by name: same name key (nicknames folded) and no Jr/Sr clash. */
function sameName(a: string, b: string): boolean {
  const ka = nameKey(a);
  return ka.includes(" ") && ka === nameKey(b) && suffixOf(a) === suffixOf(b);
}

export function matchApplicant(a: Application, all: AppEmployee[]): Match {
  const name = fullName(a);
  const email = lower(a.email);
  if (email) {
    const hits = all.filter((e) => lower(e.email) === email);
    if (hits.length === 1) return { kind: "one", employee: hits[0], reason: "email" };
    if (hits.length > 1) return { kind: "several", keys: hits.map((e) => e.employeeKey), reason: "email" };
  }
  const phone = digits10(a.phone);
  if (phone) {
    // A shared family phone isn't a match: the first name has to fit too.
    const hits = all.filter((e) => digits10(e.phone) === phone
      && ((firstOf(e.name) !== "" && firstOf(e.name) === firstOf(name)) || similarName(e.name, name)));
    if (hits.length === 1) return { kind: "one", employee: hits[0], reason: "phone" };
    if (hits.length > 1) return { kind: "several", keys: hits.map((e) => e.employeeKey), reason: "phone" };
  }
  const hits = all.filter((e) => sameName(e.name, name));
  if (hits.length > 1) return { kind: "several", keys: hits.map((e) => e.employeeKey), reason: "name" };
  if (hits.length === 1) {
    const e = hits[0];
    // Email and phone didn't match above, so any the record has disagree.
    if (!str(e.email) && !digits10(e.phone)) return { kind: "one", employee: e, reason: "name" };
  }
  return { kind: "none" };
}

// ── What to write ───────────────────────────────────────────────────────────

/** Is this application newer than the one already on the record? Same day:
 *  the higher submission ID (JotForm's IDs grow over time). */
export function isNewer(a: Pick<Application, "submittedOn" | "submissionId">, e: Pick<AppEmployee, "appliedAt" | "submissionId">): boolean {
  if (!e.appliedAt) return true;
  if (a.submittedOn !== e.appliedAt) return a.submittedOn > e.appliedAt;
  try { return BigInt(a.submissionId || "0") > BigInt(e.submissionId || "0"); } catch { return false; }
}

export type ApplicationContact = { email: string; phone: string; address: string; submissionId: string; submittedOn: string };

export function applicationContact(a: Application): ApplicationContact {
  return { email: a.email, phone: formatPhone(a.phone) || a.phone, address: a.address.text, submissionId: a.submissionId, submittedOn: a.submittedOn };
}

/** The "latest application" columns, written when this one is the newest. */
function appliedColumns(a: Application): Record<string, unknown> {
  const cols: Record<string, unknown> = {
    applied_at: `${a.submittedOn}T12:00:00Z`,
    jotform_submission_id: a.submissionId,
    application_contact: applicationContact(a),
  };
  if (a.sms != null) { cols.sms_consent = a.sms; cols.sms_consent_at = `${a.submittedOn}T12:00:00Z`; }
  return cols;
}

/** Contact columns from the application, keyed by employees column. */
function contactColumns(a: Application): Record<string, string> {
  const c: Record<string, string> = { email: a.email, phone: formatPhone(a.phone) || a.phone };
  if (a.addressStructured) {
    c.address = [a.address.line1, a.address.line2].filter(Boolean).join(" ");
    c.city = a.address.city;
  }
  if (/^[A-Z]{2}$/.test(a.address.state)) c.state_code = a.address.state;
  if (/^\d{5}$/.test(a.address.zip)) c.zip = a.address.zip;
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v));
}

const CURRENT: Record<string, (e: AppEmployee) => string> = {
  email: (e) => e.email, phone: (e) => e.phone, address: (e) => e.address,
  city: (e) => e.city, state_code: (e) => e.stateCode, zip: (e) => e.zip,
};

export type Outcome = "created" | "updated" | "matched" | "older" | "several" | "skipped";

export type Decision = {
  outcome: Outcome;
  employeeKey: string | null;
  matchReason: "email" | "phone" | "name" | null;
  /** Columns to write: the full row for "created", a patch otherwise. */
  write: Record<string, unknown> | null;
  /** Where AOS already has something different (not overwritten). */
  differences: string[];
  notes: string[];
};

export const newEmployeeKey = (submissionId: string) => `app-${submissionId}`;

export function decide(a: Application, all: AppEmployee[]): Decision {
  const junk = junkReason(a);
  if (junk) return { outcome: "skipped", employeeKey: null, matchReason: null, write: null, differences: [], notes: [junk] };
  const notes = [emailTypo(a.email)].filter((x): x is string => !!x);
  const m = matchApplicant(a, all);

  if (m.kind === "several") {
    return { outcome: "several", employeeKey: null, matchReason: m.reason, write: null, differences: [],
      notes: [...notes, `Matches ${m.keys.length} records by ${m.reason}: ${m.keys.join(", ")}`] };
  }

  const contact = contactColumns(a);
  if (m.kind === "none") {
    const key = newEmployeeKey(a.submissionId);
    return {
      outcome: "created", employeeKey: key, matchReason: null, differences: [], notes,
      write: {
        employee_key: key, full_name: fullName(a), first_name: a.firstName, last_name: a.lastName,
        employment_type: "Contractor", status: "Active", source: APPLICATION_SOURCE, is_deleted: false,
        ...contact, ...(contact.state_code ? { state: contact.state_code } : {}),
        ...appliedColumns(a),
      },
    };
  }

  const e = m.employee;
  const write: Record<string, unknown> = {};
  const differences: string[] = [];
  for (const [col, value] of Object.entries(contact)) {
    const now = str(CURRENT[col](e));
    if (!now) write[col] = value;
    else if (col === "email" && lower(now) !== lower(value)) differences.push("email");
    else if (col === "phone" && digits10(now) !== digits10(value)) differences.push("phone");
  }
  if (write.state_code) write.state = write.state_code;
  const filled = Object.keys(write).length > 0;
  const newer = isNewer(a, e);
  if (newer) Object.assign(write, appliedColumns(a));
  return {
    outcome: !newer ? "older" : filled ? "updated" : "matched",
    employeeKey: e.employeeKey, matchReason: m.reason,
    write: Object.keys(write).length ? write : null,
    differences, notes,
  };
}

/** Apply a decision to the in-memory list, so the next submission in a
 *  batch sees it (the one-time load runs newest first). */
export function applyToList(all: AppEmployee[], a: Application, d: Decision): AppEmployee[] {
  if (!d.write || !d.employeeKey) return all;
  const w = d.write as Record<string, string | undefined>;
  const patch = (e: AppEmployee): AppEmployee => ({
    ...e,
    email: w.email ?? e.email, phone: w.phone ?? e.phone, address: w.address ?? e.address, city: w.city ?? e.city,
    stateCode: w.state_code ?? e.stateCode, zip: w.zip ?? e.zip,
    appliedAt: w.applied_at ? a.submittedOn : e.appliedAt,
    submissionId: w.jotform_submission_id ?? e.submissionId,
  });
  if (d.outcome === "created") {
    const blank: AppEmployee = { employeeKey: d.employeeKey, name: fullName(a), email: "", phone: "", address: "", city: "", stateCode: "", zip: "", appliedAt: null, submissionId: null };
    return [...all, patch(blank)];
  }
  return all.map((e) => (e.employeeKey === d.employeeKey ? patch(e) : e));
}

/** Newest first: by day, then submission ID. */
export function newestFirst(list: Application[]): Application[] {
  const id = (s: string) => { try { return BigInt(s || "0"); } catch { return BigInt(0); } };
  return [...list].sort((x, y) => y.submittedOn.localeCompare(x.submittedOn) || (id(y.submissionId) > id(x.submissionId) ? 1 : id(y.submissionId) < id(x.submissionId) ? -1 : 0));
}

/** What's stored in the log about the application (no work history,
 *  references, education or résumé). */
export function logSummary(a: Application) {
  return { name: fullName(a), email: a.email, phone: a.phone, address: a.address.text, position: a.position, sms: a.sms, submittedOn: a.submittedOn };
}

// ── Onboarding: where the application differs from AOS ─────────────────────

/** The application's email/phone where AOS has a different one. A blank AOS
 *  field isn't listed (the application already filled it, or will). */
export function appliedDifferences(e: { email: string; phone: string }, c: Partial<ApplicationContact> | null | undefined): { email?: string; phone?: string } {
  if (!c) return {};
  const out: { email?: string; phone?: string } = {};
  if (str(c.email) && str(e.email) && lower(c.email!) !== lower(e.email)) out.email = str(c.email);
  if (digits10(c.phone ?? "") && digits10(e.phone) && digits10(c.phone ?? "") !== digits10(e.phone)) out.phone = str(c.phone);
  return out;
}
