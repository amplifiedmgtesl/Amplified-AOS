/**
 * app/api/users/route.ts
 *
 * GET  /api/users  — List all auth users + their profiles (admin only)
 * POST /api/users  — Create a new auth user + profile (admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return profile?.role === "admin" ? user.id : null;
}

// ─── GET /api/users ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const callerId = await requireAdmin(req);
  if (!callerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // List all auth users (paginated — Supabase returns up to 1000)
  const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // Fetch all profiles in one query
  const { data: profiles } = await supabaseAdmin.from("profiles").select("*");
  const profileMap = new Map<string, any>();
  for (const p of profiles ?? []) profileMap.set(p.id, p);

  const result = users.map((u) => {
    const p = profileMap.get(u.id) ?? null;
    return {
      id: u.id,
      email: u.email ?? "",
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      profile: p
        ? {
            id: p.id,
            role: p.role ?? "staff",
            employeeKey: p.employee_key ?? null,
            fullName: p.full_name ?? "",
            email: p.email ?? "",
          }
        : null,
    };
  });

  return NextResponse.json({ users: result });
}

// ─── POST /api/users ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const callerId = await requireAdmin(req);
  if (!callerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { email, password, role, fullName, employeeKey } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  // Create auth user
  const { data: { user }, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !user) {
    return NextResponse.json({ error: createError?.message ?? "Failed to create user." }, { status: 500 });
  }

  // Create profile
  const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
    id: user.id,
    role: role ?? "staff",
    employee_key: employeeKey || null,
    full_name: fullName || null,
    email: email,
  });

  if (profileError) {
    console.error("[api/users POST] profile upsert error:", profileError);
    // Don't fail the whole request — user is created, profile can be retried
  }

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
