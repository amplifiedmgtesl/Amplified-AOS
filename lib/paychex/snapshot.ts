/**
 * lib/paychex/snapshot.ts — the copy of Paychex kept in AOS
 * (plan: docs/paychex-snapshot-plan.md, John 2026-10-20). SERVER ONLY.
 *
 * Reading Paychex live costs ~155 calls: the worker list (~10, 50 a page)
 * plus contact info for each active worker (~143). Paychex has no search
 * and no "changed since", so screens read this copy instead:
 *   • refreshSnapshot(): Monday night, and "Refresh now". Saves the copy and
 *     applies what Paychex is the source of truth for (contact info,
 *     status, new hires, clear Payroll ID links, worker IDs). Anything
 *     unclear is left for Sync from Paychex.
 *   • refreshSnapshotData(): saves the copy only. Send to Paychex uses it
 *     when the copy is over an hour old.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchPaychexWorkers } from "./api";
import { automaticChanges, planPaychexSync, type PaychexWorker } from "./sync-plan";
import { applyOne, clearLinks, loadEmployees } from "./sync-server";

/** Send to Paychex re-reads Paychex first when the copy is older than this. */
export const SEND_MAX_AGE_MS = 60 * 60 * 1000;

// Applying stops this long after the run started (reading Paychex takes
// ~20-30 s), so a run fits in Vercel's 60 seconds. What's left shows under
// Sync from Paychex and is picked up by the next run.
const APPLY_BUDGET_MS = 45_000;

function toRow(w: PaychexWorker, contactRead: boolean, at: string) {
  return {
    worker_id: w.workerId, employee_id: w.employeeId ?? "", given_name: w.firstName, middle_name: w.middleName,
    family_name: w.lastName, status: w.status, worker_type: w.workerType, hire_date: w.hireDate,
    email: contactRead ? w.email : null, phone: contactRead ? w.phone : null, address: contactRead ? w.street : null,
    city: contactRead ? w.city : null, state_code: contactRead ? w.stateCode : null, zip: contactRead ? w.zip : null,
    contact_read: contactRead, refreshed_at: at,
  };
}

function fromRow(r: any): PaychexWorker {
  return {
    workerId: r.worker_id, employeeId: r.employee_id ?? "", workerType: r.worker_type ?? "",
    firstName: r.given_name ?? "", middleName: r.middle_name ?? "", lastName: r.family_name ?? "",
    status: r.status ?? "", hireDate: r.hire_date ? String(r.hire_date).slice(0, 10) : null,
    phone: r.phone ?? "", email: r.email ?? "", street: r.address ?? "", city: r.city ?? "",
    stateCode: r.state_code ?? "", zip: r.zip ?? "",
  };
}

/** Save one worker (after a send, or a live look-up by worker ID). */
export async function saveWorker(w: PaychexWorker, contactRead: boolean): Promise<void> {
  const { error } = await supabaseAdmin.from("paychex_workers").upsert(toRow(w, contactRead, new Date().toISOString()));
  if (error) console.error("[paychex snapshot] saveWorker failed:", error.message);
}

export type Snapshot = {
  /** Every worker (names/IDs/status). */
  all: PaychexWorker[];
  /** Active workers, with contact info. */
  active: PaychexWorker[];
  /** When the copy was last refreshed in full; null = never. */
  at: string | null;
};

export async function snapshotAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from("paychex_snapshot_runs").select("finished_at")
    .eq("ok", true).order("finished_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.finished_at ?? null;
}

export async function loadSnapshot(): Promise<Snapshot> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("paychex_workers").select("*").order("worker_id").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const all = rows.map(fromRow);
  const active = rows.filter((r) => r.status === "ACTIVE" && r.contact_read).map(fromRow);
  return { all, active, at: await snapshotAt() };
}

/** Workers for a look-alike check: active ones carry contact info. */
export function lookupWorkers(s: Snapshot): PaychexWorker[] {
  const byId = new Map(s.all.map((w) => [w.workerId, w]));
  for (const w of s.active) byId.set(w.workerId, w);
  return [...byId.values()];
}

/** Read Paychex in full and save the copy. Also fills missing worker IDs. */
async function readAndSave(): Promise<{ active: PaychexWorker[]; all: PaychexWorker[]; workerIdsFilled: number }> {
  const { active, all } = await fetchPaychexWorkers();
  const at = new Date().toISOString();
  const activeIds = new Set(active.map((w) => w.workerId));
  const rows = all.map((w) => toRow(active.find((a) => a.workerId === w.workerId) ?? w, activeIds.has(w.workerId), at));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("paychex_workers").upsert(rows.slice(i, i + 500));
    if (error) throw new Error(`Saving the Paychex copy failed: ${error.message}`);
  }
  // Workers Paychex no longer lists.
  const { error: delErr } = await supabaseAdmin.from("paychex_workers").delete().lt("refreshed_at", at);
  if (delErr) throw new Error(delErr.message);
  const { data: filled, error: fillErr } = await supabaseAdmin.rpc("fill_paychex_worker_ids");
  if (fillErr) throw new Error(`Filling worker IDs failed: ${fillErr.message}`);
  return { active, all, workerIdsFilled: Number(filled ?? 0) };
}

async function startRun(trigger: string, runBy: string | null): Promise<number> {
  const { data, error } = await supabaseAdmin.from("paychex_snapshot_runs").insert({ trigger, run_by: runBy }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function finishRun(id: number, patch: Record<string, unknown>) {
  await supabaseAdmin.from("paychex_snapshot_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", id);
}

export type RefreshSummary = {
  workers: number; active: number; workerIdsFilled: number;
  applied: { update: number; create: number; link: number }; failed: number; held: number; leftForNextRun: number;
};

/** Full refresh: save the copy, then apply the automatic changes. */
export async function refreshSnapshot(trigger: "schedule" | "manual", runBy: string | null): Promise<RefreshSummary> {
  const runId = await startRun(trigger, runBy);
  try {
    const started = Date.now();
    const { active, all, workerIdsFilled } = await readAndSave();
    const { live, reservedIds } = await loadEmployees();
    const plan = planPaychexSync(active, live, reservedIds, all);
    const clear = new Set((await clearLinks(plan.changes, active, all, reservedIds)).map((c) => c.id));
    const auto = automaticChanges(plan.changes, clear);
    const applied = { update: 0, create: 0, link: 0 };
    let failed = 0, done = 0;
    const logRun = `snap-${runId}`;
    for (; done < auto.length && Date.now() - started < APPLY_BUDGET_MS; done++) {
      const c = auto[done];
      const r = await applyOne(c, logRun, runBy, done);
      if (r.ok) applied[c.kind as keyof typeof applied]++; else failed++;
    }
    const summary: RefreshSummary = {
      workers: all.length, active: active.length, workerIdsFilled, applied, failed,
      held: plan.changes.length - auto.length + plan.reports.length, leftForNextRun: auto.length - done,
    };
    await finishRun(runId, { ok: true, workers: all.length, active: active.length, summary });
    return summary;
  } catch (e) {
    await finishRun(runId, { ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Save the copy only (Send to Paychex, when the copy is over an hour old). */
export async function refreshSnapshotData(runBy: string | null): Promise<void> {
  const runId = await startRun("send", runBy);
  try {
    const { active, all, workerIdsFilled } = await readAndSave();
    await finishRun(runId, { ok: true, workers: all.length, active: active.length, summary: { dataOnly: true, workerIdsFilled } });
  } catch (e) {
    await finishRun(runId, { ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
