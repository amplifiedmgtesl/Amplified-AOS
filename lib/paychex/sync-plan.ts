// Paychex → AOS employee sync: the planning step (backlog #117, 2026-10-14).
//
// Pure: takes the Paychex workers and the AOS employee records, returns the
// proposed changes plus report-only notes. No network, no database — the API
// route fetches both sides and applies whatever the admin ticks.
//
// Rules agreed with John (2026-10-12 / 10-14):
//   • Paychex is the source of truth for Payroll ID, phone, email and address.
//     A blank in Paychex never wipes a value AOS has.
//   • Only ACTIVE Paychex workers are read.
//   • Preview first; nothing changes until the admin applies it.
//   • Names are REPORT ONLY — AOS often holds the name the crew goes by.
//   • W-2 vs 1099 differences, and anything ambiguous, are report only.
//   • A new Paychex worker who matches exactly one AOS person without a
//     Payroll ID gets that ID on the existing record (no duplicate). Only a
//     worker with no plausible AOS match is created as a new record.

export type PaychexWorker = {
  workerId: string;
  employeeId: string;            // the Payroll ID, as Paychex shows it
  workerType: string;            // EMPLOYEE | INDEPENDENT_CONTRACTOR | …
  firstName: string;
  middleName: string;
  lastName: string;
  status: string;                // ACTIVE | INACTIVE | TERMINATED
  hireDate: string | null;       // YYYY-MM-DD
  phone: string;
  email: string;
  street: string;
  city: string;
  stateCode: string;
  zip: string;
};

export type AosEmployee = {
  employeeKey: string;
  fullName: string;
  firstName: string;
  lastName: string;
  payrollId: number | null;
  employmentType: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  stateCode: string;
  zip: string;
};

export type ContactField = "phone" | "email" | "address" | "city" | "stateCode" | "zip";

export type FieldChange = { field: ContactField; from: string; to: string };

export type SyncChange =
  | { id: string; kind: "update"; employeeKey: string; payrollId: number; name: string; fields: FieldChange[] }
  | { id: string; kind: "link"; employeeKey: string; payrollId: number; name: string; paychexName: string; matchedOn: string; fields: FieldChange[] }
  | { id: string; kind: "reid"; employeeKey: string; payrollId: number; fromPayrollId: number; name: string; paychexName: string; paychexStatus: string }
  | { id: string; kind: "clear"; employeeKey: string; payrollId: number; name: string }
  | { id: string; kind: "create"; payrollId: number; name: string; firstName: string; lastName: string;
      employmentType: "Employee" | "Contractor"; hireDate: string | null; contact: Record<ContactField, string> };

export type SyncReport = {
  kind: "name" | "type" | "ambiguous" | "id_mismatch";
  payrollId: number;
  employeeKey?: string;
  message: string;
};

export type SyncPlan = { changes: SyncChange[]; reports: SyncReport[]; activeWorkers: number };

// ── Normalising helpers ─────────────────────────────────────────────────────

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** Paychex sometimes stores the whole name in the first-name field (47 of
 *  471 workers on 2026-10-14, every recent hire). Split it back out. */
export function splitPaychexName(first: string, middle: string, last: string): { first: string; last: string } {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (l) return { first: f, last: l };
  const parts = f.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: f, last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function tokens(name: string): string[] {
  return (name ?? "")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/['-]/g, "")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t));
}

// Common short forms, so "Bob Burke" meets "Robert Leroy Burke" (10/14 dry run).
const NICK: Record<string, string> = {
  bob: "robert", rob: "robert", robbie: "robert", bobby: "robert", bill: "william", will: "william", billy: "william",
  mike: "michael", jim: "james", jimmy: "james", tom: "thomas", tommy: "thomas", dick: "richard", rick: "richard",
  ricky: "richard", tony: "anthony", joe: "joseph", joey: "joseph", dan: "daniel", danny: "daniel", dave: "david",
  steve: "steven", stephen: "steven", matt: "matthew", nick: "nicholas", sam: "samuel", ben: "benjamin",
  alex: "alexander", andy: "andrew", drew: "andrew", greg: "gregory", jeff: "jeffrey", jon: "jonathan",
  john: "jonathan", johnny: "jonathan", kate: "katherine", katie: "katherine", kathy: "katherine", hank: "henry",
  liz: "elizabeth", beth: "elizabeth", jen: "jennifer", jenny: "jennifer", abby: "abigail", abbey: "abigail",
};

/** First 3 letters of the first name + the whole last name. Catches
 *  Chris/Christopher and lower-case entries; middle initials ignored. */
export function nameKey(name: string): string {
  const t = tokens(name);
  if (t.length < 2) return t.join(" ");
  return `${(NICK[t[0]] ?? t[0]).slice(0, 3)} ${t[t.length - 1]}`;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Near-identical names: a typo or two ("Justin Alllen" / "Justin Allen"),
 *  or one first name inside the other ("DLauren" / "Lauren") with the same
 *  last name. Used only to hold back a new record, never to link. */
export function looseNameMatch(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const fa = ta[0], fb = tb[0], la = ta[ta.length - 1], lb = tb[tb.length - 1];
  if (levenshtein(`${fa} ${la}`, `${fb} ${lb}`) <= 2) return true;
  return la === lb && (fa.includes(fb) || fb.includes(fa));
}

export function digits10(phone: string): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

export function formatPhone(phone: string): string {
  const d = digits10(phone);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "";
}

const squash = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function sameValue(field: ContactField, a: string, b: string): boolean {
  if (field === "phone") return digits10(a) === digits10(b);
  if (field === "zip") return (a ?? "").trim().slice(0, 5) === (b ?? "").trim().slice(0, 5);
  return squash(a) === squash(b);
}

export function paychexEmploymentType(workerType: string): "Employee" | "Contractor" {
  return workerType === "EMPLOYEE" ? "Employee" : "Contractor";
}

function paychexContact(w: PaychexWorker): Record<ContactField, string> {
  return {
    phone: formatPhone(w.phone),
    email: (w.email ?? "").trim().toLowerCase(),
    address: (w.street ?? "").trim(),
    city: (w.city ?? "").trim(),
    stateCode: (w.stateCode ?? "").trim().toUpperCase(),
    zip: (w.zip ?? "").trim().slice(0, 5),
  };
}

/** Fields where Paychex has a value and AOS differs. Blank in Paychex = no change. */
export function contactChanges(w: PaychexWorker, e: AosEmployee): FieldChange[] {
  const px = paychexContact(w);
  const out: FieldChange[] = [];
  for (const field of ["phone", "email", "address", "city", "stateCode", "zip"] as ContactField[]) {
    const to = px[field];
    const from = (e[field] ?? "").trim();
    if (!to) continue;
    if (sameValue(field, from, to)) continue;
    out.push({ field, from, to });
  }
  return out;
}

// ── The plan ────────────────────────────────────────────────────────────────

/** `reservedIds` = Payroll IDs held by deleted AOS records. The unique
 *  constraint on employees.rippling_employee_id still counts them, so such
 *  an ID can't be given to anyone — report it instead. */
export function planPaychexSync(
  workers: PaychexWorker[],
  employees: AosEmployee[],
  reservedIds: Set<number> = new Set(),
  /** Every Paychex worker, any status (names only). Used to catch AOS
   *  Payroll IDs that don't exist in Paychex. Omit to skip that check. */
  allPaychex?: PaychexWorker[],
): SyncPlan {
  const changes: SyncChange[] = [];
  const reports: SyncReport[] = [];

  const active = workers.filter((w) => w.status === "ACTIVE" && /^\d+$/.test(w.employeeId ?? ""));
  const byPayrollId = new Map<number, AosEmployee>();
  for (const e of employees) if (e.payrollId != null) byPayrollId.set(e.payrollId, e);

  // Candidates for a brand-new Payroll ID: AOS people who don't have one yet.
  const noId = employees.filter((e) => e.payrollId == null);
  const noIdByName = new Map<string, AosEmployee[]>();
  const noIdByEmail = new Map<string, AosEmployee[]>();
  const noIdByPhone = new Map<string, AosEmployee[]>();
  const push = (m: Map<string, AosEmployee[]>, k: string, e: AosEmployee) => {
    if (!k) return;
    m.set(k, [...(m.get(k) ?? []), e]);
  };
  for (const e of noId) {
    push(noIdByName, nameKey(e.fullName || `${e.firstName} ${e.lastName}`), e);
    push(noIdByEmail, (e.email ?? "").trim().toLowerCase(), e);
    push(noIdByPhone, digits10(e.phone), e);
  }
  const withIdByName = new Map<string, AosEmployee[]>();
  for (const e of employees) if (e.payrollId != null) push(withIdByName, nameKey(e.fullName), e);

  // Two Paychex workers can claim the same AOS person (Paychex has its own
  // duplicates). Track claims so we never link one record twice.
  const claimed = new Set<string>();

  for (const w of active) {
    const payrollId = Number(w.employeeId);
    const { first, last } = splitPaychexName(w.firstName, w.middleName, w.lastName);
    const pxName = `${first} ${last}`.trim();
    const type = paychexEmploymentType(w.workerType);

    const existing = byPayrollId.get(payrollId);
    if (existing) {
      const fields = contactChanges(w, existing);
      if (fields.length) {
        changes.push({ id: `update:${existing.employeeKey}`, kind: "update", employeeKey: existing.employeeKey,
          payrollId, name: existing.fullName, fields });
      }
      if (nameKey(existing.fullName) !== nameKey(pxName) && tokens(pxName).length >= 2) {
        reports.push({ kind: "name", payrollId, employeeKey: existing.employeeKey,
          message: `#${payrollId}: AOS has "${existing.fullName}", Paychex has "${pxName}".` });
      }
      if ((existing.employmentType || "Contractor") !== type) {
        reports.push({ kind: "type", payrollId, employeeKey: existing.employeeKey,
          message: `#${payrollId} ${existing.fullName}: AOS says ${existing.employmentType || "blank"}, Paychex says ${type}.` });
      }
      continue;
    }

    if (reservedIds.has(payrollId)) {
      reports.push({ kind: "id_mismatch", payrollId,
        message: `#${payrollId} ${pxName}: this Payroll ID is still on a deleted AOS record, so it can't be given out. Fix by hand.` });
      continue;
    }

    const nk = nameKey(pxName);
    // Paychex itself has this person more than once (W-2 + 1099 records, or
    // a duplicate setup). Which number is theirs is a human call.
    const twins = active.filter((o) => o !== w && (() => {
      const n = splitPaychexName(o.firstName, o.middleName, o.lastName);
      const on = `${n.first} ${n.last}`.trim();
      return nameKey(on) === nk || looseNameMatch(on, pxName);
    })());
    if (twins.length) {
      reports.push({ kind: "ambiguous", payrollId,
        message: `#${payrollId} ${pxName}: Paychex has this person more than once (` +
          [payrollId, ...twins.map((o) => Number(o.employeeId))].sort((a, b) => a - b).map((i) => "#" + i).join(", ") +
          "). Decide which number is theirs, then add it by hand." });
      continue;
    }

    // No AOS record holds this ID. Look for the person among records with no ID.
    const email = (w.email ?? "").trim().toLowerCase();
    const phone = digits10(w.phone);
    const hits = new Map<string, { e: AosEmployee; on: string[] }>();
    const add = (list: AosEmployee[] | undefined, on: string) => {
      for (const e of list ?? []) {
        if (claimed.has(e.employeeKey)) continue;
        const h = hits.get(e.employeeKey) ?? { e, on: [] };
        h.on.push(on);
        hits.set(e.employeeKey, h);
      }
    };
    if (email) add(noIdByEmail.get(email), "email");
    if (phone) add(noIdByPhone.get(phone), "phone");
    if (nk.includes(" ")) add(noIdByName.get(nk), "name");

    // An email or phone match must also agree on the last name — shared
    // family phones and emails exist (the Strangs, 10/12).
    const lastTok = tokens(last).pop() ?? "";
    const plausible = [...hits.values()].filter((h) =>
      h.on.includes("name") || (lastTok && tokens(h.e.fullName).pop() === lastTok));

    const sameNameWithId = nk.includes(" ") ? (withIdByName.get(nk) ?? []) : [];
    if (plausible.length >= 1 && sameNameWithId.length) {
      reports.push({ kind: "id_mismatch", payrollId,
        message: `#${payrollId} ${pxName} is new in Paychex. AOS has ` +
          sameNameWithId.map((e) => `${e.fullName} with #${e.payrollId}`).join(", ") + " and " +
          plausible.map((h) => `${h.e.fullName} with no ID`).join(", ") +
          ". Same person under two Paychex IDs, or two people? Not linked." });
      continue;
    }
    if (plausible.length === 1) {
      const { e, on } = plausible[0];
      claimed.add(e.employeeKey);
      push(withIdByName, nameKey(e.fullName), { ...e, payrollId });
      changes.push({ id: `link:${e.employeeKey}:${payrollId}`, kind: "link", employeeKey: e.employeeKey, payrollId,
        name: e.fullName, paychexName: pxName, matchedOn: on.join(" + "), fields: contactChanges(w, e) });
      if ((e.employmentType || "Contractor") !== type) {
        reports.push({ kind: "type", payrollId, employeeKey: e.employeeKey,
          message: `#${payrollId} ${e.fullName}: AOS says ${e.employmentType || "blank"}, Paychex says ${type}.` });
      }
      continue;
    }
    if (plausible.length > 1) {
      reports.push({ kind: "ambiguous", payrollId,
        message: `#${payrollId} ${pxName} is new in Paychex and could be any of ${plausible.length} AOS records: ` +
          plausible.map((h) => `${h.e.fullName} (${h.e.employeeKey})`).join(", ") + ". Add the Payroll ID by hand." });
      continue;
    }
    const sameNameWithOtherId = withIdByName.get(nk) ?? [];
    if (nk.includes(" ") && sameNameWithOtherId.length) {
      reports.push({ kind: "id_mismatch", payrollId,
        message: `#${payrollId} ${pxName} is new in Paychex, but AOS already has ` +
          sameNameWithOtherId.map((e) => `${e.fullName} with #${e.payrollId}`).join(", ") +
          ". Same person under two Paychex IDs, or a different person? Not added." });
      continue;
    }
    const near = employees.filter((e) => looseNameMatch(e.fullName || `${e.firstName} ${e.lastName}`, pxName));
    if (near.length) {
      reports.push({ kind: "ambiguous", payrollId,
        message: `#${payrollId} ${pxName} is new in Paychex. Close to ` +
          near.slice(0, 3).map((e) => `${e.fullName}${e.payrollId != null ? ` (#${e.payrollId})` : " (no ID)"}`).join(", ") +
          ". A typo, or a different person? Not added." });
      continue;
    }
    if (!first || !last) {
      reports.push({ kind: "ambiguous", payrollId,
        message: `#${payrollId} "${pxName}" is new in Paychex but has no usable first and last name. Not added.` });
      continue;
    }
    changes.push({ id: `create:${payrollId}`, kind: "create", payrollId, name: pxName, firstName: first, lastName: last,
      employmentType: type, hireDate: w.hireDate, contact: paychexContact(w) });
    // A second Paychex worker with the same name is then reported, not created.
    push(withIdByName, nk, { employeeKey: `(new #${payrollId})`, fullName: pxName, firstName: first, lastName: last,
      payrollId, employmentType: type, phone: "", email: "", address: "", city: "", stateCode: "", zip: "" });
  }

  // AOS Payroll IDs Paychex doesn't have at all (old Rippling numbers).
  // Paychex is the source of truth: use Paychex's number for the person if
  // exactly one Paychex worker (any status) matches and the number is free,
  // otherwise blank it so the export flags them instead of sending a number
  // Paychex will reject.
  if (allPaychex) {
    const pxIds = new Set(allPaychex.map((w) => w.employeeId));
    const taken = new Set<number>([...byPayrollId.keys(), ...reservedIds]);
    for (const c of changes) if (c.kind === "link" || c.kind === "create") taken.add(c.payrollId);
    for (const e of employees) {
      if (e.payrollId == null || pxIds.has(String(e.payrollId))) continue;
      const name = e.fullName || `${e.firstName} ${e.lastName}`;
      const matches = allPaychex.filter((w) => {
        const { first, last } = splitPaychexName(w.firstName, w.middleName, w.lastName);
        const pn = `${first} ${last}`.trim();
        return /^\d+$/.test(w.employeeId) && (nameKey(pn) === nameKey(name) || looseNameMatch(pn, name));
      });
      const ids = [...new Set(matches.map((w) => Number(w.employeeId)))];
      if (ids.length === 1 && !taken.has(ids[0])) {
        const w = matches[0];
        const { first, last } = splitPaychexName(w.firstName, w.middleName, w.lastName);
        taken.add(ids[0]);
        changes.push({ id: `reid:${e.employeeKey}:${ids[0]}`, kind: "reid", employeeKey: e.employeeKey, payrollId: ids[0],
          fromPayrollId: e.payrollId, name, paychexName: `${first} ${last}`.trim(), paychexStatus: w.status });
      } else {
        changes.push({ id: `clear:${e.employeeKey}:${e.payrollId}`, kind: "clear", employeeKey: e.employeeKey,
          payrollId: e.payrollId, name });
        if (ids.length > 1) {
          reports.push({ kind: "ambiguous", payrollId: e.payrollId, employeeKey: e.employeeKey,
            message: `${name}: AOS #${e.payrollId} isn't in Paychex, and Paychex has ${ids.map((i) => "#" + i).join(" and ")} for that name. Pick one by hand.` });
        }
      }
    }
  }

  return { changes, reports, activeWorkers: active.length };
}
