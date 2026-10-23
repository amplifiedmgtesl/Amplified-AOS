/**
 * app/api/onboarding/route.ts — Onboarding screen list (backlog #120).
 *
 * GET → everyone on a confirmed crew assignment or timesheet from 30 days
 *       back to 30 days ahead with no Payroll ID, each with possible AOS
 *       duplicates; plus `applicants`: website applicants from the last 30
 *       days with no Payroll ID who aren't on a job (#122). Admins only.
 *       Changes nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadOnboardingRows, requireAdmin } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await loadOnboardingRows());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
