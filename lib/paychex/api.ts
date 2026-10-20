/**
 * lib/paychex/api.ts — Paychex Flex API client (backlog #117, #120).
 *
 * SERVER ONLY. Import from app/api/** route handlers, never from client code:
 * it reads PAYCHEX_API_KEY / PAYCHEX_API_SECRET from the server environment.
 *
 * Reads workers (sync, onboarding lookups) and, for the Onboarding screen
 * only, creates in-progress workers. That one write needs worker write
 * access on the "Amplified AOS" app in Flex → Company Settings →
 * Integrated apps. Worker records come back with legalId (SSN), birthDate
 * and sex — toWorker() copies only the fields we use, so those never leave
 * this file.
 */

import type { PaychexWorker } from "./sync-plan";

const BASE = "https://api.paychex.com";
const PAGE = 50;          // Paychex rejects limit > 50 with HTTP 400
const CONCURRENCY = 8;    // parallel contact lookups

export class PaychexConfigError extends Error {}

async function getToken(): Promise<string> {
  const id = process.env.PAYCHEX_API_KEY;
  const secret = process.env.PAYCHEX_API_SECRET;
  if (!id || !secret) throw new PaychexConfigError("Paychex API keys aren't set on the server (PAYCHEX_API_KEY / PAYCHEX_API_SECRET).");
  const res = await fetch(`${BASE}/auth/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Paychex sign-in failed (HTTP ${res.status}).`);
  const json = await res.json();
  return json.access_token as string;
}

async function get(token: string, path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Paychex request failed (HTTP ${res.status}) for ${path.split("?")[0]}.`);
  return res.json();
}

/** Company ID (Paychex's opaque key, not the 70400794 display number). */
async function companyIdFor(token: string): Promise<string> {
  const companies = await get(token, "/companies");
  const companyId = companies?.content?.[0]?.companyId;
  if (!companyId) throw new Error("Paychex returned no company for these API keys.");
  return companyId;
}

type RawWorker = {
  workerId: string;
  employeeId?: string;
  workerType?: string;
  name?: { givenName?: string; middleName?: string; familyName?: string };
  currentStatus?: { statusType?: string };
  hireDate?: string;
};

function toWorker(w: RawWorker): PaychexWorker {
  return {
    workerId: w.workerId,
    employeeId: String(w.employeeId ?? ""),
    workerType: w.workerType ?? "",
    firstName: w.name?.givenName ?? "",
    middleName: w.name?.middleName ?? "",
    lastName: w.name?.familyName ?? "",
    status: w.currentStatus?.statusType ?? "",
    hireDate: w.hireDate ? w.hireDate.slice(0, 10) : null,
    phone: "", email: "", street: "", city: "", stateCode: "", zip: "",
  };
}

/** Phone, email and mailing address for one worker. */
async function addContact(token: string, w: PaychexWorker): Promise<void> {
  const json = await get(token, `/workers/${encodeURIComponent(w.workerId)}/communications`);
  const list: any[] = json?.content ?? [];
  const pick = (type: string, prefer: string[]) =>
    list.filter((c) => c.type === type)
      .sort((a, b) => (prefer.indexOf(a.usageType) + 1 || 99) - (prefer.indexOf(b.usageType) + 1 || 99))[0];
  const email = pick("EMAIL", ["PERSONAL", "BUSINESS"]);
  // Seen 2026-10-14: type MOBILE_PHONE, fields dialCountry / dialArea / dialNumber.
  const phone = pick("MOBILE_PHONE", ["PERSONAL", "BUSINESS"]) ?? pick("PHONE", ["PERSONAL", "HOME", "BUSINESS"]);
  const addr = pick("STREET_ADDRESS", ["MAILING_ADDRESS", "HOME", "PERSONAL"]);
  w.email = email?.uri ?? "";
  w.phone = phone?.dialNumber ? `${phone.dialArea ?? ""}${phone.dialNumber}` : "";
  if (addr) {
    w.street = [addr.streetLineOne, addr.streetLineTwo].filter(Boolean).join(" ");
    w.city = addr.city ?? "";
    w.stateCode = addr.countrySubdivisionCode ?? "";
    w.zip = addr.postalCode ?? "";
  }
}

async function listWorkers(token: string): Promise<PaychexWorker[]> {
  const companyId = await companyIdFor(token);
  const all: PaychexWorker[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await get(token, `/companies/${encodeURIComponent(companyId)}/workers?offset=${offset}&limit=${PAGE}`);
    const rows: RawWorker[] = page?.content ?? [];
    for (const r of rows) all.push(toWorker(r));
    if (rows.length < PAGE) break;
  }
  return all;
}

/** Every Paychex worker, names/IDs/status only: about 10 calls, no contact
 *  info. The employee profile uses this, then reads contact info only for
 *  the one or few workers it needs (2026-10-20). */
export async function fetchPaychexWorkerList(): Promise<PaychexWorker[]> {
  return listWorkers(await getToken());
}

/** Every Paychex worker (names/IDs only), plus the ACTIVE ones with contact
 *  info. One call per active worker for the contact info (~470), so this is
 *  for the Onboarding page and Sync from Paychex, not per-person screens. */
export async function fetchPaychexWorkers(): Promise<{ active: PaychexWorker[]; all: PaychexWorker[] }> {
  const token = await getToken();
  const all = await listWorkers(token);
  const active = all.filter((w) => w.status === "ACTIVE");

  let i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < active.length) {
      const w = active[i++];
      await addContact(token, w);
    }
  });
  await Promise.all(workers);
  return { active, all };
}

/** One worker by Paychex workerId, with contact info. Null if Paychex has no such worker. */
export async function fetchPaychexWorker(workerId: string): Promise<PaychexWorker | null> {
  const token = await getToken();
  const res = await fetch(`${BASE}/workers/${encodeURIComponent(workerId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Paychex request failed (HTTP ${res.status}) for /workers.`);
  const json = await res.json();
  const raw: RawWorker | undefined = json?.content?.[0] ?? json;
  if (!raw?.workerId) return null;
  const w = toWorker(raw);
  await addContact(token, w);
  return w;
}

export type NewWorker = {
  givenName: string;
  familyName: string;
  workerType: "EMPLOYEE" | "INDEPENDENT_CONTRACTOR";
  email: string;
  correlationId: string;
};

/** The request body we send — also what the log and a dry run show. */
export function newWorkerBody(w: NewWorker) {
  return [{
    workerCorrelationId: w.correlationId,
    workerType: w.workerType,
    name: { givenName: w.givenName, familyName: w.familyName },
    // Paychex emails the self-onboarding invite only when an email is in the
    // first call. Same shape the communications endpoint returns to us.
    communications: [{ type: "EMAIL", usageType: "PERSONAL", uri: w.email }],
  }];
}

export type CreateResult =
  | { ok: true; status: number; worker: PaychexWorker }
  | { ok: false; status: number; error: string };

/** Create an IN_PROGRESS worker. Only a 200 workerId is trusted: a 423
 *  (account locked) can return an ID that Paychex says not to use. */
export async function createPaychexWorker(w: NewWorker): Promise<CreateResult> {
  const token = await getToken();
  const companyId = await companyIdFor(token);
  const res = await fetch(`${BASE}/companies/${encodeURIComponent(companyId)}/workers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.paychex.workers.v1+json",
    },
    body: JSON.stringify(newWorkerBody(w)),
    cache: "no-store",
  });
  const json: any = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) {
    const msg = json?.errors?.[0]?.description ?? json?.errors?.[0]?.message ?? json?.message;
    const why = res.status === 423 ? "The Paychex account is locked — try again later."
      : res.status === 401 || res.status === 403 ? "Paychex refused: the AOS app doesn't have worker write access in Flex."
      : msg ? `Paychex said: ${msg}` : "Paychex didn't accept the request.";
    return { ok: false, status: res.status, error: `${why} (HTTP ${res.status})` };
  }
  const raw: RawWorker | undefined = json?.content?.[0];
  if (!raw?.workerId) return { ok: false, status: res.status, error: "Paychex replied without a worker ID." };
  const worker = toWorker(raw);
  try { await addContact(token, worker); } catch { /* checked by the caller */ }
  return { ok: true, status: res.status, worker };
}
