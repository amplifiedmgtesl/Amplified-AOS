/**
 * app/api/paychex/snapshot/route.ts — refresh the Paychex copy in AOS
 * (docs/paychex-snapshot-plan.md).
 *
 * GET  → Vercel's weekly schedule (vercel.json: Monday ~11 pm Eastern).
 *        Vercel sends "Authorization: Bearer <CRON_SECRET>"; refused when
 *        CRON_SECRET isn't set.
 * POST → "Refresh now" (admins).
 * Both read Paychex in full (~155 calls), save the copy and apply what
 * Paychex is the source of truth for. See lib/paychex/snapshot.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { PaychexConfigError } from "@/lib/paychex/api";
import { refreshSnapshot } from "@/lib/paychex/snapshot";
import { requireAdmin } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await refreshSnapshot("schedule", null));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await refreshSnapshot("manual", userId));
  } catch (e) {
    return errorResponse(e);
  }
}
