/**
 * app/api/users/[id]/route.ts
 *
 * PATCH  /api/users/[id]  — Update email, password, and/or profile fields (admin only)
 * DELETE /api/users/[id]  — Delete auth user and their profile (admin only)
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

// ─── PATCH /api/users/[id] ────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const callerId = await requireAdmin(req);
  if (!callerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { email, password, role, fullName, employeeKey, phone, address, city, state } = body;

  // Update auth user (only if email or password provided)
  if (email || password) {
    const updates: Record<string, string> = {};
    if (email) updates.email = email;
    if (password) updates.password = password;

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, updates);
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }
  }

  // Update profile
  const profileUpdate: Record<string, any> = { id };
  if (role !== undefined) profileUpdate.role = role;
  if (fullName !== undefined) profileUpdate.full_name = fullName;
  if (employeeKey !== undefined) profileUpdate.employee_key = employeeKey || null;
  if (email !== undefined) profileUpdate.email = email;
  if (phone !== undefined) profileUpdate.phone = phone || null;
  if (address !== undefined) profileUpdate.address = address || null;
  if (city !== undefined) profileUpdate.city = city || null;
  if (state !== undefined) profileUpdate.state = state || null;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert(profileUpdate);

  if (profileError) {
    console.error("[api/users PATCH] profile upsert error:", profileError);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ─── DELETE /api/users/[id] ───────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const callerId = await requireAdmin(req);
  if (!callerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Prevent self-deletion
  if (id === callerId) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  // Delete profile first (FK may reference auth.users)
  await supabaseAdmin.from("profiles").delete().eq("id", id);

  // Delete auth user
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
