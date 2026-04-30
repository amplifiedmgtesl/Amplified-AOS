"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { ClientContact, ClientContactType } from "@/lib/store/types";

const TYPES: { value: ClientContactType; label: string }[] = [
  { value: "billing", label: "Billing" },
  { value: "quotes", label: "Quotes" },
  { value: "job", label: "Job" },
  { value: "other", label: "Other" },
];

const EMPTY_CONTACT = (clientId: string): Omit<ClientContact, "id"> => ({
  clientId,
  firstName: "",
  lastName: "",
  title: "",
  phone: "",
  email: "",
  type: "other",
  isActive: true,
});

function rowToContact(r: any): ClientContact {
  return {
    id: r.id,
    clientId: r.client_id,
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    title: r.title ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    type: (r.type as ClientContactType) ?? "other",
    isActive: r.is_active ?? true,
  };
}

function contactToRow(c: ClientContact) {
  return {
    id: c.id,
    client_id: c.clientId,
    first_name: c.firstName.trim(),
    last_name: c.lastName.trim(),
    title: c.title?.trim() || null,
    phone: c.phone?.trim() || null,
    email: c.email?.trim() || null,
    type: c.type,
    is_active: c.isActive,
    updated_at: new Date().toISOString(),
  };
}

function newId() { return `cct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

export function ClientContactsTab({
  clientId,
  onCountChange,
}: {
  clientId: string;
  onCountChange?: (count: number) => void;
}) {
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClientContact | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("client_contacts")
      .select("*")
      .eq("client_id", clientId)
      .order("type")
      .order("last_name");
    if (error) {
      setError(error.message);
      setContacts([]);
    } else {
      const list = (data ?? []).map(rowToContact);
      setContacts(list);
      onCountChange?.(list.filter((c) => c.isActive).length);
    }
    setLoading(false);
  }

  useEffect(() => { reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [clientId]);

  function startAdd() {
    setDraft({ id: newId(), ...EMPTY_CONTACT(clientId) });
    setEditingId("__new__");
  }
  function startEdit(c: ClientContact) {
    setDraft({ ...c });
    setEditingId(c.id);
  }
  function cancelEdit() {
    setDraft(null);
    setEditingId(null);
  }

  async function save() {
    if (!draft) return;
    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("client_contacts").upsert(contactToRow(draft));
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDraft(null);
    setEditingId(null);
    await reload();
  }

  async function deactivate(c: ClientContact) {
    if (!confirm(`Remove contact "${c.firstName} ${c.lastName}"?`)) return;
    const { error } = await supabase
      .from("client_contacts")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) {
      setError(error.message);
      return;
    }
    await reload();
  }

  const activeContacts = contacts.filter((c) => c.isActive);

  return (
    <div>
      {error && (
        <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {!editingId && (
        <div style={{ marginBottom: 10 }}>
          <button className="secondary" onClick={startAdd} style={{ fontSize: 12 }}>+ Add Contact</button>
        </div>
      )}

      {editingId && draft && (
        <div className="card" style={{ padding: 12, marginBottom: 12, background: "#fafbfc" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, display: "block" }}>First Name *</label>
              <input value={draft.firstName} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, display: "block" }}>Last Name *</label>
              <input value={draft.lastName} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, display: "block" }}>Title</label>
              <input value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, display: "block" }}>Type</label>
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ClientContactType })} style={{ width: "100%" }}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, display: "block" }}>Phone</label>
              <input value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, display: "block" }}>Email</label>
              <input type="email" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} style={{ width: "100%" }} />
            </div>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ fontSize: 12 }}>{saving ? "Saving..." : "Save"}</button>
            <button className="secondary" onClick={cancelEdit} disabled={saving} style={{ fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#888", fontSize: 13, padding: 12 }}>Loading...</div>
      ) : activeContacts.length === 0 ? (
        <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No contacts yet.</div>
      ) : (
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)", color: "#666", fontSize: 11 }}>
              <th style={{ textAlign: "left", padding: "6px 4px" }}>Type</th>
              <th style={{ textAlign: "left", padding: "6px 4px" }}>Name</th>
              <th style={{ textAlign: "left", padding: "6px 4px" }}>Title</th>
              <th style={{ textAlign: "left", padding: "6px 4px" }}>Phone</th>
              <th style={{ textAlign: "left", padding: "6px 4px" }}>Email</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {activeContacts.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--border-faint, #f1f3f5)" }}>
                <td style={{ padding: "6px 4px", textTransform: "capitalize" }}>{c.type}</td>
                <td style={{ padding: "6px 4px" }}>{c.firstName} {c.lastName}</td>
                <td style={{ padding: "6px 4px", color: "#555" }}>{c.title || "—"}</td>
                <td style={{ padding: "6px 4px", color: "#555" }}>{c.phone || "—"}</td>
                <td style={{ padding: "6px 4px", color: "#555" }}>{c.email || "—"}</td>
                <td style={{ padding: "6px 4px", textAlign: "right" }}>
                  <button className="secondary" onClick={() => startEdit(c)} style={{ fontSize: 11, marginRight: 4 }}>Edit</button>
                  <button className="secondary" onClick={() => deactivate(c)} style={{ fontSize: 11, color: "#c33" }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
