/**
 * app/api/jotform/load/route.ts — one-time load of past website applications
 * from JotForm's CSV export (backlog #121). Admins only.
 *
 * POST { applications: Application[], apply: boolean } → one report row per
 * submission. The page reads the CSV in the browser (lib/jotform/application
 * parseCsv + parseCsvRow) and sends it newest first: all at once for the dry
 * run, in chunks for the real load so each request stays well inside
 * Vercel's time limit. Safe to run again: anything already loaded comes back
 * as "already".
 */

import { NextRequest, NextResponse } from "next/server";
import type { Application } from "@/lib/jotform/application";
import { handleApplications } from "@/lib/jotform/server";
import { requireAdmin } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 1000;
const s = (v: unknown) => (typeof v === "string" ? v : "");

function clean(a: any): Application {
  const ad = a?.address ?? {};
  return {
    submissionId: s(a?.submissionId).replace(/\D/g, ""), submittedOn: /^\d{4}-\d{2}-\d{2}$/.test(s(a?.submittedOn)) ? a.submittedOn : "",
    firstName: s(a?.firstName), lastName: s(a?.lastName), email: s(a?.email), phone: s(a?.phone),
    address: { line1: s(ad.line1), line2: s(ad.line2), city: s(ad.city), state: s(ad.state), zip: s(ad.zip), country: s(ad.country), text: s(ad.text) },
    addressStructured: a?.addressStructured === true, position: s(a?.position),
    sms: a?.sms === true ? true : a?.sms === false ? false : null,
  };
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let apps: Application[] = [], apply = false;
  try {
    const body = await req.json();
    apps = Array.isArray(body?.applications) ? body.applications.slice(0, MAX).map(clean) : [];
    apply = body?.apply === true;
  } catch { /* empty body */ }
  if (!apps.length) return NextResponse.json({ error: "No applications." }, { status: 400 });
  try {
    return NextResponse.json({ applied: apply, report: await handleApplications(apps, "load", !apply) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
