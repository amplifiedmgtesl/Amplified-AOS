/**
 * lib/onboarding/send.ts — "Send to Paychex" for one person (backlog #120).
 *
 * SERVER ONLY. Used by app/api/onboarding/send for both a single send and
 * a batch. Creates an IN_PROGRESS worker in Paychex with the person's
 * email, so Paychex emails them the self-onboarding invite. Every attempt
 * is logged to paychex_onboard_log.
 *
 * Only production really sends. Previews and local runs are dry runs:
 * there's no Paychex test account, so a preview send would create a real
 * worker and email a real person.
 *
 * Guards: email required; one send per person (claimed in the DB before
 * calling Paychex); refuses if Paychex already has a look-alike unless the
 * admin has seen the matches and chosen to send anyway (single sends only).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createPaychexWorker, newWorkerBody, type NewWorker } from "@/lib/paychex/api";
import type { PaychexWorker } from "@/lib/paychex/sync-plan";
import { canSend, paychexMatches, splitForPaychex, type PaychexMatch } from "./plan";
import { loadEmployee, toOnbEmployee } from "./server";

export const LIVE_SEND = process.env.VERCEL_ENV === "production";

export type SendOutcome =
  | { employeeKey: string; name: string; kind: "sent"; workerId: string; payrollId: number | null; emailOnFile: boolean }
  | { employeeKey: string; name: string; kind: "dryRun"; request: unknown }
  | { employeeKey: string; name: string; kind: "needsConfirm"; matches: PaychexMatch[] }
  | { employeeKey: string; name: string; kind: "error"; error: string; unknown?: boolean };

async function log(row: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("paychex_onboard_log").insert(row);
  if (error) console.error("[onboarding/send] log failed:", error);
}

/** `workers` = every Paychex worker (contact info where we have it), fetched
 *  once by the caller; null means the admin chose to skip the look-alike check. */
export async function sendOne(employeeKey: string, userId: string, workers: PaychexWorker[] | null): Promise<SendOutcome> {
  const row = await loadEmployee(employeeKey).catch(() => null);
  if (!row || row.is_deleted) return { employeeKey, name: employeeKey, kind: "error", error: "That AOS record no longer exists." };
  const e = toOnbEmployee(row);
  const name = e.name;
  if (!canSend(e)) {
    const error = e.payrollId != null ? "Already has a Payroll ID."
      : e.paychexWorkerId ? "Already sent to Paychex."
      : "Add a valid email first — Paychex sends the invite to it.";
    return { employeeKey, name, kind: "error", error };
  }

  const { given, family } = splitForPaychex(row.first_name ?? "", row.last_name ?? "", name);
  if (!given || !family) return { employeeKey, name, kind: "error", error: "Needs a first and last name." };
  const worker: NewWorker = {
    givenName: given, familyName: family,
    workerType: e.employmentType === "Employee" ? "EMPLOYEE" : "INDEPENDENT_CONTRACTOR",
    email: e.email.trim().toLowerCase(),
    correlationId: employeeKey,
  };
  const request = newWorkerBody(worker);

  if (workers) {
    const matches = paychexMatches(e, workers);
    if (matches.length) return { employeeKey, name, kind: "needsConfirm", matches };
  }

  if (!LIVE_SEND) {
    await log({ sent_by: userId, employee_key: employeeKey, dry_run: true, request, ok: true });
    return { employeeKey, name, kind: "dryRun", request };
  }

  // Claim the send so a double-click or second tab can't create two workers.
  const { data: claimed, error: claimErr } = await supabaseAdmin.from("employees")
    .update({ paychex_invited_at: new Date().toISOString(), paychex_invited_by: userId })
    .eq("employee_key", employeeKey).is("paychex_worker_id", null).is("paychex_invited_at", null)
    .is("rippling_employee_id", null).select("employee_key");
  if (claimErr) return { employeeKey, name, kind: "error", error: claimErr.message };
  if (!claimed?.length) return { employeeKey, name, kind: "error", error: "Already sent (or sending) — refresh." };

  let result;
  try {
    result = await createPaychexWorker(worker);
  } catch (err) {
    // We don't know whether Paychex created the worker. Keep the claim so
    // nobody re-sends blind; Check Paychex will find it by name/email.
    const msg = err instanceof Error ? err.message : "Unknown error";
    await log({ sent_by: userId, employee_key: employeeKey, dry_run: false, request, ok: false, error: `No reply from Paychex: ${msg}` });
    return { employeeKey, name, kind: "error", unknown: true,
      error: "No reply from Paychex — it may or may not have been created. Use Check Paychex before doing anything else." };
  }

  if (!result.ok) {
    // A definite refusal: release the claim so it can be fixed and resent.
    await supabaseAdmin.from("employees").update({ paychex_invited_at: null, paychex_invited_by: null })
      .eq("employee_key", employeeKey).is("paychex_worker_id", null);
    await log({ sent_by: userId, employee_key: employeeKey, dry_run: false, request,
      response_status: result.status, ok: false, error: result.error });
    return { employeeKey, name, kind: "error", error: result.error };
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
    return { employeeKey, name, kind: "error", unknown: true,
      error: `Created in Paychex (worker ${w.workerId}) but AOS couldn't save it: ${saveErr.message}. Don't resend.` };
  }
  return { employeeKey, name, kind: "sent", workerId: w.workerId, payrollId: (patch.rippling_employee_id as number) ?? null, emailOnFile };
}
