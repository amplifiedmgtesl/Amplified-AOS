/**
 * app/api/jotform/application/[secret]/route.ts — JotForm webhook for the
 * website Employee Application form (backlog #121).
 *
 * POST (multipart, sent by JotForm on each submission): formID,
 * submissionID and rawRequest (the answers as JSON). Matches the applicant
 * to an existing employee or creates a Contractor; see lib/jotform.
 *
 * No JotForm API key on purpose: the account also holds the Direct
 * Deposit / W-9 / I-9 forms. The address carries a secret
 * (JOTFORM_WEBHOOK_SECRET in Vercel), and any other form is refused.
 */

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { EMPLOYEE_APPLICATION_FORM_ID, parseWebhook } from "@/lib/jotform/application";
import { handleApplications } from "@/lib/jotform/server";
import { todayLocal } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

function secretOk(given: string): boolean {
  const want = process.env.JOTFORM_WEBHOOK_SECRET ?? "";
  if (want.length < 24) return false;   // unset or too short: refuse everything
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (!secretOk(secret)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let formId = "", submissionId = "", raw: Record<string, unknown> = {};
  try {
    const form = await req.formData();
    formId = String(form.get("formID") ?? "");
    submissionId = String(form.get("submissionID") ?? "");
    raw = JSON.parse(String(form.get("rawRequest") ?? "{}"));
  } catch {
    return NextResponse.json({ error: "Unreadable submission" }, { status: 400 });
  }
  if (formId !== EMPLOYEE_APPLICATION_FORM_ID) return NextResponse.json({ error: "Wrong form" }, { status: 400 });

  try {
    const [row] = await handleApplications([parseWebhook(raw, submissionId, todayLocal())], "webhook", false);
    return NextResponse.json({ ok: row?.outcome !== "error", outcome: row?.outcome });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
