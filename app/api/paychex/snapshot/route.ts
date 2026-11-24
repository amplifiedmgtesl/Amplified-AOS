/**
 * app/api/paychex/snapshot/route.ts — refresh the Paychex copy in AOS, in two
 * steps (docs/paychex-snapshot-plan.md, John 10/20):
 *   ?step=pull     read Paychex (~525 calls, ~30-60 s) and save the copy;
 *                  refused with 409 while another read is running;
 *   ?step=process  apply what Paychex is the source of truth for, from the
 *                  copy (no Paychex calls).
 *
 * GET  → Vercel's weekly schedule (vercel.json: pull Monday ~11 pm Eastern,
 *        process 30 minutes later). Vercel sends "Authorization: Bearer
 *        <CRON_SECRET>"; refused when CRON_SECRET isn't set.
 * POST → "Update from Paychex" (admins and Onboarding users): the page calls pull, then process.
 *        ?step=catchup: Onboarding and Payroll call this when they open; it
 *        processes only if the last refresh left work undone.
 *        ?step=status: { running } — is a read of Paychex running now? The
 *        screens grey out Update from Paychex and Send while it is.
 */

import { NextRequest, NextResponse } from "next/server";
import { PaychexConfigError } from "@/lib/paychex/api";
import { PaychexBusyError, processPending, processSnapshot, pullRunning, pullSnapshot } from "@/lib/paychex/snapshot";
import { requireOnboarding } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";
// 300 s (Fluid compute on Hobby): a full read took ~60-70 s by 11/24.
export const maxDuration = 300;

function errorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Unknown error";
  if (e instanceof PaychexBusyError) return NextResponse.json({ error: msg, busy: true }, { status: 409 });
  return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
}

async function run(step: string | null, trigger: "schedule" | "manual", runBy: string | null) {
  if (step === "pull") return NextResponse.json(await pullSnapshot(trigger, runBy));
  if (step === "process") return NextResponse.json(await processSnapshot(runBy));
  if (step === "status") return NextResponse.json({ running: await pullRunning() });
  // Opening Onboarding or Payroll: finish anything the last refresh left.
  if (step === "catchup") {
    return NextResponse.json((await processPending()) ? { ran: true, ...(await processSnapshot(runBy)) } : { ran: false });
  }
  return NextResponse.json({ error: "step must be pull, process, catchup or status" }, { status: 400 });
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
  const userId = await requireOnboarding(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return await run(req.nextUrl.searchParams.get("step"), "manual", userId);
  } catch (e) {
    return errorResponse(e);
  }
}
