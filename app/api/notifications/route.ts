/**
 * app/api/notifications/route.ts
 *
 * GET  /api/notifications  — provider status (which channels are live vs mock) + config flags
 * POST /api/notifications  — fire a notification (used by the IT-only test surface)
 *
 * IT-only. Feature modules do NOT call this route — they import notify()
 * from lib/notifications/dispatch directly (server-side). This HTTP entry
 * exists for the test/preview UI and any future external trigger.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatch";
import { getProviderStatus } from "@/lib/notifications/providers";
import { getConfig } from "@/lib/notifications/config";
import type { NotifyInput } from "@/lib/notifications/types";

const IT_EMAIL = "jobrien@synergypro.com";

async function requireIT(req: NextRequest): Promise<boolean> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return false;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return false;
  return user.email === IT_EMAIL;
}

export async function GET(req: NextRequest) {
  if (!(await requireIT(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = getConfig();
  return NextResponse.json({
    providers: getProviderStatus(),
    enabled: config.enabled,
    fromEmail: config.fromEmail,
    ccEmail: config.ccEmail,
    smsConfigured: !!config.smsFrom,
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireIT(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: NotifyInput;
  try {
    input = (await req.json()) as NotifyInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!input?.event || !Array.isArray(input.channels) || input.channels.length === 0) {
    return NextResponse.json(
      { error: "Body must include `event` and a non-empty `channels` array." },
      { status: 400 },
    );
  }

  try {
    const result = await notify(input);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[api/notifications POST] notify error:", e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
