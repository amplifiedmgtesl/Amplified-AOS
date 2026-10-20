/**
 * lib/onboarding/link.ts — put a Paychex worker's Payroll ID on an AOS
 * record (backlog #120). SERVER ONLY.
 *
 * Used by "Use ID" and by the automatic clear-match link when Onboarding
 * opens. Only lands on a record that still has no Payroll ID. Blank AOS
 * email/phone are filled from Paychex; nothing AOS has is overwritten.
 * Logged to paychex_sync_log either way.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatPhone, type PaychexWorker } from "@/lib/paychex/sync-plan";
import { loadEmployee } from "./server";

export async function linkPaychexId(
  employeeKey: string, w: PaychexWorker, userId: string, runId: string,
): Promise<{ ok: true; payrollId: number } | { ok: false; error: string }> {
  let before: any = null;
  let after: Record<string, unknown> = {};
  const payrollId = w.employeeId && Number.isFinite(Number(w.employeeId)) ? Number(w.employeeId) : null;
  try {
    before = await loadEmployee(employeeKey);
    if (!before || before.is_deleted) throw new Error("That AOS record no longer exists.");
    if (before.rippling_employee_id != null) throw new Error(`This person already has Payroll ID ${before.rippling_employee_id}.`);
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
    return { ok: true, payrollId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await supabaseAdmin.from("paychex_sync_log").insert({
      run_id: runId, run_by: userId, change_id: `link:${employeeKey}:${payrollId ?? "?"}`, kind: "link",
      employee_key: employeeKey, payroll_id: payrollId, before, after, ok: false, error: msg,
    });
    return { ok: false, error: msg };
  }
}
