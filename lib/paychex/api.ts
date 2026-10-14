/**
 * lib/paychex/api.ts — read-only Paychex Flex API client (backlog #117).
 *
 * SERVER ONLY. Import from app/api/** route handlers, never from client code:
 * it reads PAYCHEX_API_KEY / PAYCHEX_API_SECRET from the server environment.
 *
 * The app ("Amplified AOS" in Flex → Company Settings → Integrated apps) has
 * GET-only access. Worker records come back with legalId (SSN), birthDate
 * and sex even so — toWorker() copies only the fields we use, so those
 * never leave this file.
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

/** Every Paychex worker (names/IDs only), plus the ACTIVE ones with contact info. */
export async function fetchPaychexWorkers(): Promise<{ active: PaychexWorker[]; all: PaychexWorker[] }> {
  const token = await getToken();
  const companies = await get(token, "/companies");
  const companyId = companies?.content?.[0]?.companyId;
  if (!companyId) throw new Error("Paychex returned no company for these API keys.");

  const all: PaychexWorker[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await get(token, `/companies/${encodeURIComponent(companyId)}/workers?offset=${offset}&limit=${PAGE}`);
    const rows: RawWorker[] = page?.content ?? [];
    for (const r of rows) all.push(toWorker(r));
    if (rows.length < PAGE) break;
  }
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
