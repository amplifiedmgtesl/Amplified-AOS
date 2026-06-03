"use client";

/**
 * components/shared/user-management.tsx
 *
 * Full CRUD UI for managing Supabase auth users and their profiles.
 * Calls /api/users and /api/users/[id] via fetch, passing the current
 * session token so the server can verify admin access.
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadEmployees } from "@/lib/store/app-store";
import type { UserWithProfile } from "@/lib/store/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = await getToken();
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

// ─── Blank form state ─────────────────────────────────────────────────────────

const blankForm = () => ({
  email: "",
  password: "",
  role: "staff",
  fullName: "",
  employeeKey: "",
});

type FormState = ReturnType<typeof blankForm>;

// ─── Component ────────────────────────────────────────────────────────────────

export function UserManagement() {
  const [users, setUsers] = useState<UserWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [mode, setMode] = useState<"none" | "create" | "edit">("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Employee list for linking (prefer staff-typed records)
  const employees = loadEmployees();
  const staffEmployees = employees.filter((e) => e.type === "staff");
  const employeeOptions = staffEmployees.length > 0 ? staffEmployees : employees;

  // ─── Load users ─────────────────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/users");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setUsers(
        (j.users as UserWithProfile[]).sort((a, b) =>
          (a.profile?.fullName || a.email).localeCompare(b.profile?.fullName || b.email)
        )
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // ─── Modal helpers ───────────────────────────────────────────────────────────

  function openCreate() {
    setForm(blankForm());
    setFormError(null);
    setEditingId(null);
    setMode("create");
  }

  function openEdit(u: UserWithProfile) {
    setForm({
      email: u.email,
      password: "",
      role: u.profile?.role ?? "staff",
      fullName: u.profile?.fullName ?? "",
      employeeKey: u.profile?.employeeKey ?? "",
    });
    setFormError(null);
    setEditingId(u.id);
    setMode("edit");
  }

  function closeModal() {
    setMode("none");
    setEditingId(null);
    setFormError(null);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ─── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setFormError(null);
    try {
      if (mode === "create") {
        if (!form.email.trim()) throw new Error("Email is required.");
        if (!form.password.trim()) throw new Error("Password is required.");
        const res = await apiFetch("/api/users", {
          method: "POST",
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
      } else if (mode === "edit" && editingId) {
        const payload: Record<string, any> = { ...form };
        if (!payload.password) delete payload.password;
        const res = await apiFetch(`/api/users/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
      }
      closeModal();
      await loadUsers();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setConfirmDeleteId(null);
      await loadUsers();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="card">
        <div className="action-row" style={{ marginBottom: 16 }}>
          <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
            {loading ? "Loading…" : `${users.length} User${users.length !== 1 ? "s" : ""}`}
          </h2>
          <button className="secondary" onClick={loadUsers} disabled={loading}>↻ Refresh</button>
          <button onClick={openCreate}>+ Add User</button>
        </div>

        {error && (
          <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "10px 14px", color: "#a00", marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Display Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Linked Employee</th>
                <th>Last Sign-In</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "40px 0" }} className="muted">
                    No users found.
                  </td>
                </tr>
              )}
              {users.map((u) => {
                const linkedEmp = employees.find((e) => e.employeeKey === u.profile?.employeeKey);
                return (
                  <tr key={u.id}>
                    <td><strong>{u.profile?.fullName || <span className="muted">—</span>}</strong></td>
                    <td>{u.email}</td>
                    <td>
                      <span className="badge" style={
                        u.profile?.role === "admin"
                          ? { background: "linear-gradient(180deg,#e8f0fb,#cfddf5)", borderColor: "#a0bbdf", color: "#1a3a6a" }
                          : u.profile?.role === "crew_leader"
                          ? { background: "linear-gradient(180deg,#edf7ed,#d0ecd0)", borderColor: "#90c890", color: "#1a4a1a" }
                          : u.profile?.role === "coordinator"
                          ? { background: "linear-gradient(180deg,#fbf1e4,#f2dcb8)", borderColor: "#d9b472", color: "#5a3a10" }
                          : u.profile?.role === "payroll"
                          ? { background: "linear-gradient(180deg,#f5e9f7,#e3c8ea)", borderColor: "#b98ac4", color: "#4a1a55" }
                          : {}}>
                        {u.profile?.role === "crew_leader" ? "Crew Leader" : u.profile?.role === "coordinator" ? "Coordinator" : u.profile?.role === "payroll" ? "Payroll" : (u.profile?.role ?? "staff")}
                      </span>
                    </td>
                    <td>
                      {linkedEmp
                        ? <>{linkedEmp.fullName} <span className="muted" style={{ fontSize: 11 }}>({linkedEmp.employeeKey})</span></>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="muted">{u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "Never"}</td>
                    <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="action-row">
                        <button className="secondary" onClick={() => openEdit(u)}>Edit</button>
                        {confirmDeleteId === u.id ? (
                          <>
                            <button
                              onClick={() => handleDelete(u.id)}
                              disabled={deleting}
                              style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }}
                            >
                              {deleting ? "Deleting…" : "Confirm Delete"}
                            </button>
                            <button className="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                          </>
                        ) : (
                          <button className="secondary" style={{ color: "#a00", borderColor: "#e0a0a0" }} onClick={() => setConfirmDeleteId(u.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {mode !== "none" && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <h2 className="section-title">{mode === "create" ? "Add New User" : "Edit User"}</h2>

            {formError && (
              <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "10px 14px", color: "#a00", marginBottom: 16, fontSize: 13 }}>
                {formError}
              </div>
            )}

            <div className="grid2">
              <div style={{ gridColumn: "1 / -1" }}>
                <small>Full Name</small>
                <input value={form.fullName} onChange={(e) => setField("fullName", e.target.value)} placeholder="Jane Smith" />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <small>{mode === "edit" ? "Email (leave blank to keep unchanged)" : "Email *"}</small>
                <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} placeholder="jane@example.com" />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <small>{mode === "edit" ? "New Password (leave blank to keep unchanged)" : "Password *"}</small>
                <input type="password" value={form.password} onChange={(e) => setField("password", e.target.value)}
                  placeholder={mode === "edit" ? "Leave blank to keep current" : "Min 6 characters"}
                  autoComplete="new-password" />
              </div>

              <div>
                <small>Role</small>
                <select value={form.role} onChange={(e) => setField("role", e.target.value)}>
                  <option value="staff">Staff</option>
                  <option value="coordinator">Coordinator</option>
                  <option value="crew_leader">Crew Leader</option>
                  <option value="payroll">Payroll</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <small>Phone</small>
                {(() => {
                  const linked = employees.find((e) => e.employeeKey === form.employeeKey);
                  return linked?.phone
                    ? <input value={linked.phone} readOnly style={{ background: "var(--accent-soft)", color: "var(--muted)", cursor: "default" }} title="From linked employee record" />
                    : <input value="" readOnly placeholder="Link an employee record to show phone" style={{ color: "var(--muted)", cursor: "default" }} />;
                })()}
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <small>Link to Employee Record</small>
                <select value={form.employeeKey} onChange={(e) => setField("employeeKey", e.target.value)}>
                  <option value="">— Not linked —</option>
                  {employeeOptions
                    .sort((a, b) => a.fullName.localeCompare(b.fullName))
                    .map((e) => (
                      <option key={e.employeeKey} value={e.employeeKey}>
                        {e.fullName} ({e.employeeKey})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="action-row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
              <button className="secondary" onClick={closeModal}>Cancel</button>
              <button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : mode === "create" ? "Create User" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
