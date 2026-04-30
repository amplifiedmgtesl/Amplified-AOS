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

const NEW_ROW_ID = "__new__";

const EMPTY_CONTACT = (clientId: string): ClientContact => ({
  id: NEW_ROW_ID,
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

function contactToRow(c: ClientContact, persistedId: string) {
  return {
    id: persistedId,
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

const COL_GRID = "90px 1fr 1fr 130px 1fr 70px";
const inputStyle: React.CSSProperties = { width: "100%", fontSize: 12, padding: "4px 6px" };

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
      .eq("is_active", true)
      .order("type")
      .order("last_name");
    if (error) {
      setError(error.message);
      setContacts([]);
    } else {
      const list = (data ?? []).map(rowToContact);
      setContacts(list);
      onCountChange?.(list.length);
    }
    setLoading(false);
  }

  useEffect(() => { reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [clientId]);

  function startAdd() {
    setDraft(EMPTY_CONTACT(clientId));
    setEditingId(NEW_ROW_ID);
    setError(null);
  }
  function startEdit(c: ClientContact) {
    setDraft({ ...c });
    setEditingId(c.id);
    setError(null);
  }
  function cancelEdit() {
    setDraft(null);
    setEditingId(null);
    setError(null);
  }

  async function save() {
    if (!draft) return;
    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const persistedId = draft.id === NEW_ROW_ID ? newId() : draft.id;
    const { error } = await supabase.from("client_contacts").upsert(contactToRow(draft, persistedId));
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

  function renderEditRow(d: ClientContact, isNew: boolean) {
    return (
      <div
        key={isNew ? NEW_ROW_ID : d.id}
        style={{
          display: "grid", gridTemplateColumns: COL_GRID, gap: 6, alignItems: "center",
          padding: "6px 4px", background: "#fafbfc", border: "1px solid var(--border, #e5e7eb)", borderRadius: 4,
        }}
      >
        <select value={d.type} onChange={(e) => setDraft({ ...d, type: e.target.value as ClientContactType })} style={inputStyle}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          <input placeholder="First *" value={d.firstName} onChange={(e) => setDraft({ ...d, firstName: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
          <input placeholder="Last *" value={d.lastName} onChange={(e) => setDraft({ ...d, lastName: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
        </div>
        <input placeholder="Title" value={d.title ?? ""} onChange={(e) => setDraft({ ...d, title: e.target.value })} style={inputStyle} />
        <input placeholder="Phone" value={d.phone ?? ""} onChange={(e) => setDraft({ ...d, phone: e.target.value })} style={inputStyle} />
        <input type="email" placeholder="Email" value={d.email ?? ""} onChange={(e) => setDraft({ ...d, email: e.target.value })} style={inputStyle} />
        <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
          <button onClick={save} disabled={saving} title="Save" style={{ fontSize: 11, padding: "3px 6px" }}>✓</button>
          <button className="secondary" onClick={cancelEdit} disabled={saving} title="Cancel" style={{ fontSize: 11, padding: "3px 6px" }}>×</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", padding: "6px 10px", borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {/* Header row */}
      <div style={{
        display: "grid", gridTemplateColumns: COL_GRID, gap: 6, padding: "0 4px 6px",
        fontSize: 11, color: "#666", fontWeight: 600, borderBottom: "1px solid var(--border, #e5e7eb)",
      }}>
        <div>Type</div>
        <div>Name</div>
        <div>Title</div>
        <div>Phone</div>
        <div>Email</div>
        <div></div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 0" }}>
        {loading ? (
          <div style={{ color: "#888", fontSize: 12, padding: 8 }}>Loading...</div>
        ) : contacts.length === 0 && editingId !== NEW_ROW_ID ? (
          <div style={{ color: "#888", fontSize: 12, textAlign: "center", padding: "12px 0" }}>No contacts yet.</div>
        ) : (
          contacts.map((c) =>
            editingId === c.id && draft
              ? renderEditRow(draft, false)
              : (
                <div
                  key={c.id}
                  style={{
                    display: "grid", gridTemplateColumns: COL_GRID, gap: 6, alignItems: "center",
                    padding: "5px 4px", borderBottom: "1px solid var(--border-faint, #f1f3f5)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ textTransform: "capitalize" }}>{c.type}</div>
                  <div>{c.firstName} {c.lastName}</div>
                  <div style={{ color: "#555" }}>{c.title || "—"}</div>
                  <div style={{ color: "#555" }}>{c.phone || "—"}</div>
                  <div style={{ color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email || "—"}</div>
                  <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                    <button className="secondary" onClick={() => startEdit(c)} title="Edit" style={{ fontSize: 11, padding: "3px 6px" }}>✎</button>
                    <button className="secondary" onClick={() => deactivate(c)} title="Remove" style={{ fontSize: 11, padding: "3px 6px", color: "#c33" }}>×</button>
                  </div>
                </div>
              )
          )
        )}

        {editingId === NEW_ROW_ID && draft && renderEditRow(draft, true)}
      </div>

      {!editingId && (
        <button className="secondary" onClick={startAdd} style={{ fontSize: 12, marginTop: 6 }}>+ Add Contact</button>
      )}
    </div>
  );
}
