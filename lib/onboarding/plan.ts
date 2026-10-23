// Onboarding screen: the planning step (backlog #120, 2026-10-20).
//
// Pure: takes employees plus their crew/timesheet activity, returns the
// people who are working (30 days back to 30 days ahead) with no Payroll
// ID, each with any other AOS record that looks like the same person.
// No network, no database. The API route fetches both sides.
//
// Duplicate rules follow the 10/12 duplicates file:
//   • same email, or same phone with a compatible first name: strong
//   • same first-3-letters + last name (nicknames folded): strong
//   • a typo or two apart: possible
//   • sounds alike (Soundex, at most 2 letters off): possible (10/21)
//   • same phone, different first name (family share phones): possible
//   • Jr/Sr/II differs: possible only (father and son)
// Pairs Connor has marked "not the same person" are skipped.

import { digits10, levenshtein, nameKey, soundsAlikeName, splitPaychexName, type PaychexWorker } from "@/lib/paychex/sync-plan";

export type OnbEmployee = {
  employeeKey: string;
  name: string;
  email: string;
  phone: string;
  employmentType: string;
  payrollId: number | null;
  status: string;
  paychexWorkerId: string | null;
  paychexInvitedAt: string | null;
  /** What they typed on their website application (backlog #121). */
  applicationContact?: { email?: string; phone?: string } | null;
  /** YYYY-MM-DD of their latest website application, if any. */
  appliedAt?: string | null;
};

export type Activity = {
  employeeKey: string;
  date: string;            // YYYY-MM-DD
  kind: "crew" | "time";
  jobName: string;
  hours: number;
};

export type DupMatch = {
  employeeKey: string;
  name: string;
  payrollId: number | null;
  email: string;
  phone: string;
  reason: string;
  strong: boolean;
};

export type OnboardingRow = OnbEmployee & {
  /** Earliest day worked in the window: the oldest pay owed. */
  firstWorked: { date: string; jobName: string } | null;
  lastWorked: { date: string; jobName: string } | null;
  nextBooked: { date: string; jobName: string } | null;
  hours: number;
  duplicates: DupMatch[];
  /** Applicants section: the position they typed on the application. */
  appliedPosition?: string;
};

/** How far back the Applicants section looks (John, 10/23). */
export const APPLICANT_DAYS = 30;

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function windowRange(today: string, back = 30, ahead = 30): { from: string; to: string } {
  return { from: addDays(today, -back), to: addDays(today, ahead) };
}

/** One row per unordered pair, smaller key first (matches the DB check). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const SUFFIX = /\b(jr|sr|ii|iii|iv)\b\.?/i;
const suffixOf = (name: string) => (name.match(SUFFIX)?.[1] ?? "").toLowerCase();
const firstOf = (name: string) => nameKey(name).split(" ")[0] ?? "";
const cleanEmail = (s: string) => (s ?? "").trim().toLowerCase();
const nameParts = (name: string) => {
  const t = (name ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((x) => x && !SUFFIX.test(x));
  return { first: t[0] ?? "", last: t.length > 1 ? t[t.length - 1] : "" };
};

/** A typo apart, but stricter than the sync's looseNameMatch, which let
 *  "Aaron Smith" meet "Falon Smith" and "Javon Smith" (2026-10-20 test).
 *  Same last name: first names start with the same letter and are one
 *  letter apart (two for long names), or one is inside the other.
 *  Same first three letters: last names one letter apart. */
export function similarName(a: string, b: string): boolean {
  const x = nameParts(a), y = nameParts(b);
  if (!x.first || !x.last || !y.first || !y.last) return false;
  if (x.last === y.last) {
    if (x.first === y.first) return true;
    if (x.first.includes(y.first) || y.first.includes(x.first)) return true;
    const allowed = Math.min(x.first.length, y.first.length) >= 6 ? 2 : 1;
    return x.first[0] === y.first[0] && levenshtein(x.first, y.first) <= allowed;
  }
  // Cameron Pasley / Camran Paisley (one person, 10/12): first names share
  // their first three letters, last names one letter apart.
  return x.first.slice(0, 3) === y.first.slice(0, 3) && x.last[0] === y.last[0] && levenshtein(x.last, y.last) <= 1;
}

/** Why `b` looks like the same person as `a`, or null. */
export function duplicateReason(a: OnbEmployee, b: OnbEmployee): { reason: string; strong: boolean } | null {
  const sameSuffix = suffixOf(a.name) === suffixOf(b.name);
  const ea = cleanEmail(a.email), eb = cleanEmail(b.email);
  const pa = digits10(a.phone), pb = digits10(b.phone);
  const ka = nameKey(a.name), kb = nameKey(b.name);
  const firstOk = firstOf(a.name) !== "" && firstOf(a.name) === firstOf(b.name);

  let hit: { reason: string; strong: boolean } | null = null;
  if (ea && ea === eb) hit = { reason: "Same email", strong: true };
  else if (pa && pa === pb && (firstOk || similarName(a.name, b.name))) hit = { reason: "Same phone", strong: true };
  else if (ka.includes(" ") && ka === kb) hit = { reason: "Same name", strong: true };
  else if (similarName(a.name, b.name)) hit = { reason: "Similar name", strong: false };
  else if (soundsAlikeName(a.name, b.name)) hit = { reason: "Sounds alike", strong: false };
  else if (pa && pa === pb) hit = { reason: "Same phone, different name", strong: false };
  if (!hit) return null;
  if (!sameSuffix) return { reason: `${hit.reason} (Jr/Sr differs)`, strong: false };
  return hit;
}

export function findDuplicates(e: OnbEmployee, all: OnbEmployee[], notSame: Set<string>): DupMatch[] {
  const out: DupMatch[] = [];
  for (const o of all) {
    if (o.employeeKey === e.employeeKey || notSame.has(pairKey(e.employeeKey, o.employeeKey))) continue;
    const r = duplicateReason(e, o);
    if (r) out.push({ employeeKey: o.employeeKey, name: o.name, payrollId: o.payrollId, email: o.email, phone: o.phone, ...r });
  }
  // Strong first, then whoever already has a Payroll ID.
  return out.sort((x, y) => Number(y.strong) - Number(x.strong) || Number(y.payrollId != null) - Number(x.payrollId != null));
}

/** Everyone in the window with no Payroll ID. `all` = every live employee. */
export function buildOnboardingRows(
  today: string,
  all: OnbEmployee[],
  activity: Activity[],
  notSame: Set<string>,
): OnboardingRow[] {
  const { from, to } = windowRange(today);
  const byKey = new Map(all.map((e) => [e.employeeKey, e]));
  const acc = new Map<string, OnboardingRow>();
  for (const a of activity) {
    if (a.date < from || a.date > to) continue;
    const e = byKey.get(a.employeeKey);
    if (!e || e.payrollId != null) continue;
    let row = acc.get(e.employeeKey);
    if (!row) {
      row = { ...e, firstWorked: null, lastWorked: null, nextBooked: null, hours: 0, duplicates: [] };
      acc.set(e.employeeKey, row);
    }
    if (a.kind === "time") row.hours += a.hours || 0;
    const item = { date: a.date, jobName: a.jobName };
    if (a.date <= today) {
      if (!row.lastWorked || a.date > row.lastWorked.date) row.lastWorked = item;
      if (!row.firstWorked || a.date < row.firstWorked.date) row.firstWorked = item;
    }
    else if (!row.nextBooked || a.date < row.nextBooked.date) row.nextBooked = item;
  }
  const rows = [...acc.values()];
  for (const r of rows) {
    r.hours = Math.round(r.hours * 100) / 100;
    r.duplicates = findDuplicates(r, all, notSame);
  }
  // Oldest job date first: whoever has waited longest to be paid is on top;
  // people only booked ahead go to the bottom, soonest first (John, 10/20).
  const sortDate = (r: OnboardingRow) => r.firstWorked?.date ?? r.nextBooked?.date ?? "9999";
  return rows.sort((a, b) =>
    sortDate(a).localeCompare(sortDate(b))
    || (a.firstWorked ?? a.nextBooked)?.jobName.localeCompare((b.firstWorked ?? b.nextBooked)?.jobName ?? "") || 0
    || a.name.localeCompare(b.name));
}

/** Applicants section (backlog #122): applied on the website in the last
 *  30 days, no Payroll ID, and not already in the top list (`listed`).
 *  Newest application first. The server fills in appliedPosition. */
export function buildApplicantRows(
  today: string,
  all: OnbEmployee[],
  listed: Set<string>,
  notSame: Set<string>,
): OnboardingRow[] {
  const from = addDays(today, -APPLICANT_DAYS);
  const rows: OnboardingRow[] = all
    .filter((e) => e.appliedAt && e.appliedAt >= from && e.payrollId == null && !listed.has(e.employeeKey))
    .map((e) => ({
      ...e, firstWorked: null, lastWorked: null, nextBooked: null, hours: 0,
      duplicates: findDuplicates(e, all, notSame), appliedPosition: "",
    }));
  return rows.sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? "") || a.name.localeCompare(b.name));
}

/** Which record to keep by default when merging: the one with the Payroll ID,
 *  then the one with more timesheet entries. */
export function defaultKeep(
  a: { employeeKey: string; payrollId: number | null; entries: number },
  b: { employeeKey: string; payrollId: number | null; entries: number },
): string {
  if ((a.payrollId != null) !== (b.payrollId != null)) return a.payrollId != null ? a.employeeKey : b.employeeKey;
  return b.entries > a.entries ? b.employeeKey : a.employeeKey;
}

/** Send to Paychex needs a real-looking email. */
export function canSend(e: Pick<OnbEmployee, "email" | "payrollId" | "paychexWorkerId">): boolean {
  return e.payrollId == null && !e.paychexWorkerId && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e.email ?? "").trim());
}

// ── Paychex matches ─────────────────────────────────────────────────────────

export type PaychexMatch = {
  workerId: string;
  payrollId: number | null;   // Paychex employeeId; null until Paychex assigns one
  name: string;
  status: string;
  workerType: string;
  reason: string;
};

const pxName = (w: PaychexWorker) => {
  const { first, last } = splitPaychexName(w.firstName, w.middleName, w.lastName);
  return `${first} ${last}`.trim();
};

/** Every Paychex worker who looks like this person: the one AOS sent (by
 *  worker ID), then email/phone/name matches. Paychex has its own
 *  duplicates, so there can be several; Connor picks. */
export function paychexMatches(e: OnbEmployee, workers: PaychexWorker[]): PaychexMatch[] {
  const email = cleanEmail(e.email), phone = digits10(e.phone), key = nameKey(e.name);
  const out: PaychexMatch[] = [];
  for (const w of workers) {
    const name = pxName(w);
    let reason = "";
    if (e.paychexWorkerId && w.workerId === e.paychexWorkerId) reason = "Sent from AOS";
    else if (email && cleanEmail(w.email) === email) reason = "Same email";
    else if (phone && digits10(w.phone) === phone) reason = "Same phone";
    else if (key.includes(" ") && nameKey(name) === key) reason = "Same name";
    else if (similarName(e.name, name)) reason = "Similar name";
    else if (soundsAlikeName(e.name, name)) reason = "Sounds alike";
    if (!reason) continue;
    const id = Number(w.employeeId);
    out.push({ workerId: w.workerId, payrollId: w.employeeId && Number.isFinite(id) ? id : null, name, status: w.status, workerType: w.workerType, reason });
  }
  const rank = ["Sent from AOS", "Same email", "Same phone", "Same name", "Similar name", "Sounds alike"];
  return out.sort((a, b) => rank.indexOf(a.reason) - rank.indexOf(b.reason) || Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE"));
}

/** First/last for the Paychex create call: AOS's first/last if it has them,
 *  else split the full name on the last space. */
export function splitForPaychex(first: string, last: string, full: string): { given: string; family: string } {
  if ((first ?? "").trim() && (last ?? "").trim()) return { given: first.trim(), family: last.trim() };
  const s = splitPaychexName(full, "", "");
  return { given: s.first, family: s.last };
}

// ── Merge: values to choose between ─────────────────────────────────────────

export type MergeSide = { employeeKey: string; fullName: string; firstName: string; lastName: string; email: string; phone: string };
export type MergeField = "name" | "email" | "phone";

const sideName = (s: MergeSide) => (s.fullName || `${s.firstName} ${s.lastName}`).trim();

/** Fields where both records have a value and they differ — the merge would
 *  otherwise silently keep the kept record's value. Blanks aren't listed:
 *  the merge already fills a blank from the other record. */
export function mergeConflicts(a: MergeSide, b: MergeSide): MergeField[] {
  const out: MergeField[] = [];
  const na = sideName(a), nb = sideName(b);
  if (na && nb && na.replace(/\s+/g, " ").toLowerCase() !== nb.replace(/\s+/g, " ").toLowerCase()) out.push("name");
  const ea = cleanEmail(a.email), eb = cleanEmail(b.email);
  if (ea && eb && ea !== eb) out.push("email");
  const pa = digits10(a.phone) || a.phone.trim(), pb = digits10(b.phone) || b.phone.trim();
  if (pa && pb && pa !== pb) out.push("phone");
  return out;
}

/** What to write onto the kept record after the merge, for each field where
 *  the admin picked the other record's value. */
export function mergeOverrides(
  keep: MergeSide, other: MergeSide, picks: Partial<Record<MergeField, string>>,
): { fullName?: string; firstName?: string; lastName?: string; email?: string; phone?: string } {
  const o: ReturnType<typeof mergeOverrides> = {};
  if (picks.name === other.employeeKey) {
    o.fullName = sideName(other); o.firstName = other.firstName.trim(); o.lastName = other.lastName.trim();
  }
  if (picks.email === other.employeeKey) o.email = other.email.trim();
  if (picks.phone === other.employeeKey) o.phone = other.phone.trim();
  return o;
}

// ── Clear matches: linked without anyone clicking (John, 2026-10-20) ────────
//
// Used by the Onboarding page (on open) and by Sync from Paychex, so the two
// can't drift apart. A person's Paychex match is clear when ALL of:
//   • the person has no Payroll ID and no AOS duplicates flagged
//     (otherwise the ID might belong on the other record — merge first);
//   • Paychex has exactly one possible match, and it has a Payroll ID;
//   • it matched on the worker AOS sent, email, phone, or the exact name
//     (a "similar name" typo match never counts);
//   • a name-only match is with an ACTIVE worker (Paychex only gives us
//     contact info for active workers) and isn't contradicted: if both
//     sides have contact info, some of it agrees. An inactive name-only
//     match (Evelyn Adams #206, prod dry run 10/20) waits for a person;
//   • no other AOS record (deleted ones included) holds that Payroll ID.

const CLEAR_REASONS = new Set(["Sent from AOS", "Same email", "Same phone", "Same name"]);

export function clearMatch(
  person: OnbEmployee,
  matches: PaychexMatch[],
  worker: (workerId: string) => PaychexWorker | undefined,
  aosDuplicates: DupMatch[],
  takenIds: Set<number>,
): PaychexMatch | null {
  if (person.payrollId != null || aosDuplicates.length || matches.length !== 1) return null;
  const m = matches[0];
  if (m.payrollId == null || !CLEAR_REASONS.has(m.reason) || takenIds.has(m.payrollId)) return null;
  if (m.reason === "Same name") {
    if (m.status !== "ACTIVE") return null;
    const w = worker(m.workerId);
    const aosEmail = cleanEmail(person.email), aosPhone = digits10(person.phone);
    const pxEmail = cleanEmail(w?.email ?? ""), pxPhone = digits10(w?.phone ?? "");
    const comparable = (aosEmail && pxEmail) || (aosPhone && pxPhone);
    const agrees = (aosEmail && aosEmail === pxEmail) || (aosPhone && aosPhone === pxPhone);
    if (comparable && !agrees) return null;
  }
  return m;
}
