/**
 * app/api/onboarding/paychex/route.ts — "Check Paychex" (backlog #120).
 *
 * POST { keys: string[] } → for each of these AOS people, every Paychex
 * worker who looks like them (email, phone, name, or the worker AOS sent).
 * Read only. Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchPaychexWorker, fetchPaychexWorkers, PaychexConfigError } from "@/lib/paychex/api";
import { paychexMatches, type PaychexMatch } from "@/lib/onboarding/plan";
import { requireAdmin, toOnbEmployee } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const keys: string[] = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === "string").slice(0, 500) : [];
  if (!keys.length) return NextResponse.json({ matches: {} });
  try {
    const people = [];
    for (let i = 0; i < keys.length; i += 200) {
      const { data, error } = await supabaseAdmin.from("employees").select("*").in("employee_key", keys.slice(i, i + 200));
      if (error) throw new Error(error.message);
      people.push(...(data ?? []).map(toOnbEmployee));
    }
    const { active, all } = await fetchPaychexWorkers();
    // Active workers carry contact info; use those copies where we have them.
    const byId = new Map(all.map((w) => [w.workerId, w]));
    for (const w of active) byId.set(w.workerId, w);
    // Workers AOS sent may still be in progress and missing from the list.
    for (const p of people) {
      if (p.paychexWorkerId && !byId.has(p.paychexWorkerId)) {
        const w = await fetchPaychexWorker(p.paychexWorkerId);
        if (w) byId.set(w.workerId, w);
      }
    }
    const workers = [...byId.values()];
    const matches: Record<string, PaychexMatch[]> = {};
    for (const p of people) matches[p.employeeKey] = paychexMatches(p, workers);
    return NextResponse.json({ matches, checkedAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
  }
}
