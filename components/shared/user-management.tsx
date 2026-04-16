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
  phone: "",
  address: "",
  city: "",
  state: "",
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

  // Employee list for linking
  const employees = loadEmployees();

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

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // ─── Open create modal ───────────────────────────────────────────────────────

  function openCreate() {
    setForm(blankForm());
    setFormError(null);
    setEditingId(null);
    setMode("create");
  }

  // ─── Open edit modal ─────────────────────────────────────────────────────────

  function openEdit(u: UserWithProfile) {
    setForm({
      email: u.email,
      password: "",                          // never pre-fill password
      role: u.profile?.role ?? "staff",
      fullName: u.profile?.fullName ?? "",
      employeeKey: u.profile?.employeeKey ?? "",
      phone: u.profile?.phone ?? "",
      address: u.profile?.address ?? "",
      city: u.profile?.city ?? "",
      state: u.profile?.state ?? "",
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

  // ─── Save (create or edit) ───────────────────────────────────────────────────

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
        if (!payload.password) delete payload.password; // don't send empty password

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
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ color: "#ccc", fontSize: 13 }}>
            {loading ? "Loading…" : `${users.length} user${users.length !== 1 ? "s" : ""}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={loadUsers}
            disabled={loading}
            style={btnStyle("secondary")}
          >
            ↻ Refresh
          </button>
          <button onClick={openCreate} style={btnStyle("primary")}>
            + Add User
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "#3a1a1a", border: "1px solid #c0392b", borderRadius: 6, padding: "12px 16px", color: "#e74c3c", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Users table */}
      {!loading && !error && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333" }}>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Linked Employee</Th>
                <Th>Last Sign-In</Th>
                <Th>Created</Th>
                <Th style={{ textAlign: "right" }}>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "40px 0", color: "#666" }}>
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const linkedEmp = employees.find((e) => e.employeeKey === u.profile?.employeeKey);
                  return (
                    <tr
                      key={u.id}
                      style={{ borderBottom: "1px solid #222" }}
                    >
                      <Td>{u.profile?.fullName || <span style={{ color: "#555" }}>—</span>}</Td>
                      <Td>{u.email}</Td>
                      <Td>
                        <span style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: u.profile?.role === "admin" ? "#1a3a5a" : "#1a3a1a",
                          color: u.profile?.role === "admin" ? "#5aabf0" : "#5abf5a",
                          textTransform: "uppercase",
                        }}>
                          {u.profile?.role ?? "staff"}
                        </span>
                      </Td>
                      <Td>
                        {linkedEmp
                          ? <span style={{ color: "#7ec8e3" }}>{linkedEmp.fullName} <span style={{ color: "#555", fontSize: 11 }}>({linkedEmp.employeeKey})</span></span>
                          : u.profile?.employeeKey
                          ? <span style={{ color: "#888" }}>{u.profile.employeeKey}</span>
                          : <span style={{ color: "#444" }}>—</span>
                        }
                      </Td>
                      <Td style={{ color: "#888" }}>
                        {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "Never"}
                      </Td>
                      <Td style={{ color: "#888" }}>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </Td>
                      <Td style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button onClick={() => openEdit(u)} style={btnStyle("secondary", "sm")}>
                            Edit
                          </button>
                          {confirmDeleteId === u.id ? (
                            <>
                              <button
                                onClick={() => handleDelete(u.id)}
                                disabled={deleting}
                                style={btnStyle("danger", "sm")}
                              >
                                {deleting ? "Deleting…" : "Confirm"}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                style={btnStyle("secondary", "sm")}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(u.id)}
                              style={btnStyle("danger-ghost", "sm")}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal overlay */}
      {mode !== "none" && (
        <div
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div style={{
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: 10,
            padding: 28,
            width: "100%",
            maxWidth: 520,
            maxHeight: "90vh",
            overflowY: "auto",
          }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18, color: "#fff" }}>
              {mode === "create" ? "Add New User" : "Edit User"}
            </h2>

            {formError && (
              <div style={{ background: "#3a1a1a", border: "1px solid #c0392b", borderRadius: 6, padding: "10px 14px", color: "#e74c3c", marginBottom: 16, fontSize: 13 }}>
                {formError}
              </div>
            )}

            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Full Name">
                <input
                  style={inputStyle()}
                  value={form.fullName}
                  onChange={(e) => setField("fullName", e.target.value)}
                  placeholder="Jane Smith"
                />
              </Field>

              <Field label={mode === "edit" ? "Email (leave blank to keep unchanged)" : "Email *"}>
                <input
                  style={inputStyle()}
                  type="email"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="jane@example.com"
                />
              </Field>

              <Field label={mode === "edit" ? "New Password (leave blank to keep unchanged)" : "Password *"}>
                <input
                  style={inputStyle()}
                  type="password"
                  value={form.password}
                  onChange={(e) => setField("password", e.target.value)}
                  placeholder={mode === "edit" ? "Leave blank to keep current" : "Min 6 characters"}
                  autoComplete="new-password"
                />
              </Field>

              <Field label="Role">
                <select
                  style={inputStyle()}
                  value={form.role}
                  onChange={(e) => setField("role", e.target.value)}
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>

              <Field label="Link to Employee Record">
                <select
                  style={inputStyle()}
                  value={form.employeeKey}
                  onChange={(e) => setField("employeeKey", e.target.value)}
                >
                  <option value="">— Not linked —</option>
                  {(employees.some((e) => e.type === "staff")
                    ? employees.filter((e) => e.type === "staff")
                    : employees
                  )
                    .sort((a, b) => a.fullName.localeCompare(b.fullName))
                    .map((e) => (
                      <option key={e.employeeKey} value={e.employeeKey}>
                        {e.fullName} ({e.employeeKey})
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="Phone">
                <input
                  style={inputStyle()}
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="(555) 555-5555"
                />
              </Field>

              <Field label="Address">
                <input
                  style={inputStyle()}
                  value={form.address}
                  onChange={(e) => setField("address", e.target.value)}
                  placeholder="123 Main St"
                />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                <Field label="City">
                  <input
                    style={inputStyle()}
                    value={form.city}
                    onChange={(e) => setField("city", e.target.value)}
                    placeholder="Nashville"
                  />
                </Field>
                <Field label="State">
                  <input
                    style={inputStyle()}
                    value={form.state}
                    onChange={(e) => setField("state", e.target.value)}
                    placeholder="TN"
                    maxLength={2}
                  />
                </Field>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
              <button onClick={closeModal} style={btnStyle("secondary")}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} style={btnStyle("primary")}>
                {saving ? "Saving…" : mode === "create" ? "Create User" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ textAlign: "left", padding: "8px 10px", color: "#888", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", ...style }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: "10px 10px", verticalAlign: "middle", color: "#ddd", ...style }}>
      {children}
    </td>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "8px 10px",
    color: "#fff",
    fontSize: 13,
    boxSizing: "border-box",
  };
}

function btnStyle(variant: "primary" | "secondary" | "danger" | "danger-ghost", size: "sm" | "md" = "md"): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: size === "sm" ? 12 : 13,
    padding: size === "sm" ? "5px 10px" : "8px 16px",
    border: "1px solid transparent",
    whiteSpace: "nowrap",
  };
  if (variant === "primary") return { ...base, background: "#2563eb", color: "#fff", border: "1px solid #2563eb" };
  if (variant === "secondary") return { ...base, background: "transparent", color: "#aaa", border: "1px solid #444" };
  if (variant === "danger") return { ...base, background: "#c0392b", color: "#fff", border: "1px solid #c0392b" };
  if (variant === "danger-ghost") return { ...base, background: "transparent", color: "#c0392b", border: "1px solid #c0392b" };
  return base;
}
