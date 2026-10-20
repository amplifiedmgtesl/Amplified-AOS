/**
 * app/api/onboarding/not-same/route.ts — "Not the same person" (backlog #120).
 *
 * POST { a, b } → remember that these two employee records are different
 * people, so the possible-duplicate flag stops showing. Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const a = typeof body?.a === "string" ? body.a : "";
  const b = typeof body?.b === "string" ? body.b : "";
  if (!a || !b || a === b) return NextResponse.json({ error: "Pick two different records." }, { status: 400 });
  const [key_a, key_b] = a < b ? [a, b] : [b, a];
  const { error } = await supabaseAdmin.from("employee_not_duplicate")
    .upsert({ key_a, key_b, decided_by: userId }, { onConflict: "key_a,key_b" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
