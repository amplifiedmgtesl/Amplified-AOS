/**
 * app/api/onboarding/use-id/route.ts — "Use this ID" (backlog #120).
 *
 * POST { employeeKey, workerId } → re-read that Paychex worker and put its
 * Payroll ID on the AOS record (only if the record still has none). Blank
 * AOS email/phone are filled from Paychex; nothing AOS has is overwritten.
 * Logged to paychex_sync_log. Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchPaychexWorker, PaychexConfigError } from "@/lib/paychex/api";
import { formatPhone } from "@/lib/paychex/sync-plan";
import { loadEmployee, requireAdmin } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const employeeKey = typeof body?.employeeKey === "string" ? body.employeeKey : "";
  const workerId = typeof body?.workerId === "string" ? body.workerId : "";
  if (!employeeKey || !workerId) return NextResponse.json({ error: "Missing employee or Paychex worker." }, { status: 400 });

  const runId = `onb-${Date.now()}`;
  let before: any = null;
  let after: Record<string, unknown> = {};
  let payrollId: number | null = null;
  try {
    before = await loadEmployee(employeeKey);
    if (!before || before.is_deleted) throw new Error("That AOS record no longer exists.");
    if (before.rippling_employee_id != null) throw new Error(`This person already has Payroll ID ${before.rippling_employee_id}.`);

    const w = await fetchPaychexWorker(workerId);
    if (!w) throw new Error("Paychex has no such worker any more.");
    payrollId = w.employeeId && Number.isFinite(Number(w.employeeId)) ? Number(w.employeeId) : null;
    if (payrollId == null) throw new Error("Paychex hasn't given this worker a Payroll ID yet — usually it appears once onboarding is finished.");

    // Unique Payroll ID includes deleted records — name the holder rather
    // than surfacing a constraint error.
    const { data: holder } = await supabaseAdmin.from("employees")
      .select("employee_key, full_name, is_deleted").eq("rippling_employee_id", payrollId).maybeSingle();
    if (holder) {
      throw new Error(holder.is_deleted
        ? `Payroll ID ${payrollId} is on a deleted record (${holder.full_name || holder.employee_key}). Ask Claude to clear it.`
        : `Payroll ID ${payrollId} is already on ${holder.full_name || holder.employee_key}. If that's the same person, merge them instead.`);
    }

    after = { rippling_employee_id: payrollId };
    if (!before.paychex_worker_id) after.paychex_worker_id = w.workerId;
    if (!(before.email ?? "").trim() && w.email) after.email = w.email.trim().toLowerCase();
    if (!(before.phone ?? "").trim() && w.phone) after.phone = formatPhone(w.phone);

    const { data: updated, error } = await supabaseAdmin.from("employees").update(after)
      .eq("employee_key", employeeKey).is("rippling_employee_id", null).select("employee_key");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("Record changed — refresh and try again.");

    await supabaseAdmin.from("paychex_sync_log").insert({
      run_id: runId, run_by: userId, change_id: `link:${employeeKey}:${payrollId}`, kind: "link",
      employee_key: employeeKey, payroll_id: payrollId, before, after, ok: true,
    });
    return NextResponse.json({ ok: true, payrollId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await supabaseAdmin.from("paychex_sync_log").insert({
      run_id: runId, run_by: userId, change_id: `link:${employeeKey}:${payrollId ?? "?"}`, kind: "link",
      employee_key: employeeKey, payroll_id: payrollId, before, after, ok: false, error: msg,
    });
    return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 400 });
  }
}
