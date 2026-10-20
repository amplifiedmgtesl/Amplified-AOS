/**
 * app/api/onboarding/send/route.ts — "Send to Paychex" (backlog #120).
 *
 * POST { employeeKey, ignoreMatches? } → create an IN_PROGRESS worker in
 * Paychex with the person's email, so Paychex emails them the
 * self-onboarding invite. Admins only. Every attempt is logged to
 * paychex_onboard_log.
 *
 * Only production really sends. Previews and local runs are dry runs:
 * there's no Paychex test account, so a preview send would create a real
 * worker and email a real person.
 *
 * Guards: email required; one send per person (claimed in the DB before
 * calling Paychex); refuses if Paychex already has a look-alike unless the
 * admin has seen the matches and chosen to send anyway.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createPaychexWorker, fetchPaychexWorkers, newWorkerBody, PaychexConfigError, type NewWorker } from "@/lib/paychex/api";
import { canSend, paychexMatches, splitForPaychex } from "@/lib/onboarding/plan";
import { loadEmployee, requireAdmin, toOnbEmployee } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIVE = process.env.VERCEL_ENV === "production";

async function log(row: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("paychex_onboard_log").insert(row);
  if (error) console.error("[onboarding/send] log failed:", error);
}

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const employeeKey = typeof body?.employeeKey === "string" ? body.employeeKey : "";
  const ignoreMatches = body?.ignoreMatches === true;
  if (!employeeKey) return NextResponse.json({ error: "Missing employee." }, { status: 400 });

  const row = await loadEmployee(employeeKey).catch(() => null);
  if (!row || row.is_deleted) return NextResponse.json({ error: "That AOS record no longer exists." }, { status: 404 });
  const e = toOnbEmployee(row);
  if (!canSend(e)) {
    const why = e.payrollId != null ? "This person already has a Payroll ID."
      : e.paychexWorkerId ? "Already sent to Paychex."
      : "Add a valid email first — Paychex sends the invite to it.";
    return NextResponse.json({ error: why }, { status: 400 });
  }

  const { given, family } = splitForPaychex(row.first_name ?? "", row.last_name ?? "", e.name);
  if (!given || !family) return NextResponse.json({ error: "Needs a first and last name." }, { status: 400 });
  const worker: NewWorker = {
    givenName: given, familyName: family,
    workerType: e.employmentType === "Employee" ? "EMPLOYEE" : "INDEPENDENT_CONTRACTOR",
    email: e.email.trim().toLowerCase(),
    correlationId: employeeKey,
  };
  const request = newWorkerBody(worker);

  try {
    if (!ignoreMatches) {
      const { active, all } = await fetchPaychexWorkers();
      const byId = new Map(all.map((w) => [w.workerId, w]));
      for (const w of active) byId.set(w.workerId, w);
      const matches = paychexMatches(e, [...byId.values()]);
      if (matches.length) return NextResponse.json({ needsConfirm: true, matches }, { status: 409 });
    }

    if (!LIVE) {
      await log({ sent_by: userId, employee_key: employeeKey, dry_run: true, request, ok: true });
      return NextResponse.json({ dryRun: true, request });
    }

    // Claim the send so a double-click or second tab can't create two workers.
    const { data: claimed, error: claimErr } = await supabaseAdmin.from("employees")
      .update({ paychex_invited_at: new Date().toISOString(), paychex_invited_by: userId })
      .eq("employee_key", employeeKey).is("paychex_worker_id", null).is("paychex_invited_at", null)
      .is("rippling_employee_id", null).select("employee_key");
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed?.length) return NextResponse.json({ error: "Already sent (or sending) — refresh." }, { status: 409 });

    let result;
    try {
      result = await createPaychexWorker(worker);
    } catch (err) {
      // We don't know whether Paychex created the worker. Keep the claim so
      // nobody re-sends blind; Check Paychex will find it by name/email.
      const msg = err instanceof Error ? err.message : "Unknown error";
      await log({ sent_by: userId, employee_key: employeeKey, dry_run: false, request, ok: false,
        error: `No reply from Paychex: ${msg}` });
      return NextResponse.json({ error: "No reply from Paychex — it may or may not have been created. Use Check Paychex before doing anything else." }, { status: 502 });
    }

    if (!result.ok) {
      // A definite refusal: release the claim so it can be fixed and resent.
      await supabaseAdmin.from("employees").update({ paychex_invited_at: null, paychex_invited_by: null })
        .eq("employee_key", employeeKey).is("paychex_worker_id", null);
      await log({ sent_by: userId, employee_key: employeeKey, dry_run: false, request,
        response_status: result.status, ok: false, error: result.error });
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    const w = result.worker;
    const patch: Record<string, unknown> = { paychex_worker_id: w.workerId };
    const pid = w.employeeId && Number.isFinite(Number(w.employeeId)) ? Number(w.employeeId) : null;
    if (pid != null) {
      const { data: holder } = await supabaseAdmin.from("employees").select("employee_key").eq("rippling_employee_id", pid).maybeSingle();
      if (!holder) patch.rippling_employee_id = pid;
    }
    const { error: saveErr } = await supabaseAdmin.from("employees").update(patch).eq("employee_key", employeeKey);
    const emailOnFile = !!w.email;
    await log({ sent_by: userId, employee_key: employeeKey, dry_run: false, request, response_status: result.status,
      response: { workerId: w.workerId, employeeId: w.employeeId, status: w.status, workerType: w.workerType, emailOnFile },
      worker_id: w.workerId, ok: true, error: saveErr ? `Saved in Paychex but not in AOS: ${saveErr.message}` : null });
    if (saveErr) {
      return NextResponse.json({ error: `Created in Paychex (worker ${w.workerId}) but AOS couldn't save it: ${saveErr.message}. Don't resend.` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, workerId: w.workerId, payrollId: patch.rippling_employee_id ?? null, emailOnFile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: err instanceof PaychexConfigError ? 503 : 500 });
  }
}
