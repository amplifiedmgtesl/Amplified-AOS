/**
 * app/api/onboarding/use-id/route.ts — "Use ID" (backlog #120).
 *
 * POST { employeeKey, workerId } → re-read that Paychex worker and put its
 * Payroll ID on the AOS record (see lib/onboarding/link.ts). Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchPaychexWorker, PaychexConfigError } from "@/lib/paychex/api";
import { requireAdmin } from "@/lib/onboarding/server";
import { linkPaychexId } from "@/lib/onboarding/link";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const employeeKey = typeof body?.employeeKey === "string" ? body.employeeKey : "";
  const workerId = typeof body?.workerId === "string" ? body.workerId : "";
  if (!employeeKey || !workerId) return NextResponse.json({ error: "Missing employee or Paychex worker." }, { status: 400 });
  try {
    const w = await fetchPaychexWorker(workerId);
    if (!w) return NextResponse.json({ error: "Paychex has no such worker any more." }, { status: 400 });
    const r = await linkPaychexId(employeeKey, w, userId, `onb-${Date.now()}`);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
  }
}
