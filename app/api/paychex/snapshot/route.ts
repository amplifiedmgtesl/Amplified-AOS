/**
 * app/api/paychex/snapshot/route.ts — refresh the Paychex copy in AOS, in two
 * steps (docs/paychex-snapshot-plan.md, John 10/20):
 *   ?step=pull     read Paychex (~155 calls, ~20-30 s) and save the copy;
 *   ?step=process  apply what Paychex is the source of truth for, from the
 *                  copy (no Paychex calls).
 *
 * GET  → Vercel's weekly schedule (vercel.json: pull Monday ~11 pm Eastern,
 *        process 30 minutes later). Vercel sends "Authorization: Bearer
 *        <CRON_SECRET>"; refused when CRON_SECRET isn't set.
 * POST → "Refresh now" (admins): the page calls pull, then process.
 *        ?step=catchup: Onboarding and Payroll call this when they open; it
 *        processes only if the last refresh left work undone.
 */

import { NextRequest, NextResponse } from "next/server";
import { PaychexConfigError } from "@/lib/paychex/api";
import { processPending, processSnapshot, pullSnapshot } from "@/lib/paychex/snapshot";
import { requireAdmin } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
}

async function run(step: string | null, trigger: "schedule" | "manual", runBy: string | null) {
  if (step === "pull") return NextResponse.json(await pullSnapshot(trigger, runBy));
  if (step === "process") return NextResponse.json(await processSnapshot(runBy));
  // Opening Onboarding or Payroll: finish anything the last refresh left.
  if (step === "catchup") {
    return NextResponse.json((await processPending()) ? { ran: true, ...(await processSnapshot(runBy)) } : { ran: false });
  }
  return NextResponse.json({ error: "step must be pull or process" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return await run(req.nextUrl.searchParams.get("step"), "schedule", null);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return await run(req.nextUrl.searchParams.get("step"), "manual", userId);
  } catch (e) {
    return errorResponse(e);
  }
}
