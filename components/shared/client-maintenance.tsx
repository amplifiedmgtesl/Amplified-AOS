"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { upsertClient, mergeClients } from "@/lib/store/app-store";
import type { Client } from "@/lib/store/types";

const EMPTY_CLIENT: Omit<Client, "id"> = {
  name: "", contactName: "", billTo: "", email: "", phone: "",
  address: "", city: "", state: "", zip: "", notes: "", isActive: true,
};

async function fetchClients(): Promise<{ clients: Client[]; error: string | null }> {
  const { data, error } = await supabase.from("clients").select("*").order("name");
  if (error) return { clients: [], error: error.message };
  const clients = (data ?? []).map((r: any) => ({
    id: r.id, name: r.name ?? "", contactName: r.contact_name ?? "",
    billTo: r.bill_to ?? "", email: r.email ?? "", phone: r.phone ?? "",
    address: r.address ?? "", city: r.city ?? "", state: r.state ?? "",
    zip: r.zip ?? "", notes: r.notes ?? "", isActive: r.is_active,
  }));
  return { clients, error: null };
}

function newId() { return `clt-${Date.now()}`; }

export default function ClientMaintenance() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Client | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);

  async function reload() {
    setLoading(true);
    const { clients, error } = await fetchClients();
    setClients(clients);
    setFetchError(error);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  const active = clients.filter((c) => c.isActive);
  const filtered = active.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.contactName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function selectClient(c: Client) {
    setSelectedId(c.id);
    setForm({ ...c });
    setDirty(false);
  }

  function startNew() {
    const id = newId();
    setSelectedId(id);
    setForm({ id, ...EMPTY_CLIENT });
    setDirty(true);
  }

  function updateField(field: keyof Client, value: string | boolean) {
    if (!form) return;
    setForm({ ...form, [field]: value });
    setDirty(true);
  }

  async function saveForm() {
    if (!form || !form.name.trim()) return;
    setSaving(true);
    upsertClient({ ...form, name: form.name.trim() });
    setDirty(false);
    setSaving(false);
    setStatusMsg({ text: "Client saved.", ok: true });
    await reload();
    // Re-select by id so list refreshes correctly
    setSelectedId(form.id);
  }

  function cancelEdit() {
    if (!selectedId) return;
    const original = clients.find((c) => c.id === selectedId);
    if (original) {
      setForm({ ...original });
      setDirty(false);
    } else {
      setSelectedId(null);
      setForm(null);
    }
  }

  async function runMerge() {
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) return;
    const source = clients.find((c) => c.id === mergeSourceId);
    const target = clients.find((c) => c.id === mergeTargetId);
    if (!source || !target) return;
    setMerging(true);
    const err = await mergeClients(mergeSourceId, mergeTargetId);
    setMerging(false);
    if (err) {
      setStatusMsg({ text: err, ok: false });
    } else {
      setStatusMsg({ text: `Merged "${source.name}" into "${target.name}".`, ok: true });
      setMergeSourceId("");
      setMergeTargetId("");
      setShowMerge(false);
      setSelectedId(null);
      setForm(null);
      await reload();
    }
  }

  const selectedClient = form;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", height: "100%" }}>
      {/* ── Left: list ── */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            style={{ flex: 1 }}
          />
          <button onClick={startNew} title="Add new client" style={{ whiteSpace: "nowrap" }}>+ New</button>
        </div>

        {fetchError && (
          <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "8px 12px", color: "#a00", marginBottom: 10, fontSize: 13 }}>
            {fetchError}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {loading ? (
            <div className="muted" style={{ fontSize: 13, padding: "8px 4px" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, padding: "8px 4px" }}>No clients found.</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => selectClient(c)}
                style={{
                  textAlign: "left", background: selectedId === c.id ? "var(--accent, #2563eb)" : "transparent",
                  color: selectedId === c.id ? "#fff" : "inherit",
                  border: "1px solid " + (selectedId === c.id ? "var(--accent, #2563eb)" : "var(--border, #e5e7eb)"),
                  borderRadius: 6, padding: "8px 12px", cursor: "pointer", width: "100%",
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                {c.contactName && <div style={{ fontSize: 12, opacity: 0.8 }}>{c.contactName}</div>}
              </button>
            ))
          )}
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            {active.length} client{active.length !== 1 ? "s" : ""}
          </div>
          <button
            className="secondary"
            style={{ fontSize: 12, width: "100%" }}
            onClick={() => { setShowMerge(!showMerge); setStatusMsg(null); }}
          >
            {showMerge ? "Hide Merge" : "Merge Duplicates…"}
          </button>
        </div>
      </div>

      {/* ── Right: form or merge panel ── */}
      <div style={{ flex: 1 }}>
        {statusMsg && (
          <div className="card" style={{
            background: statusMsg.ok ? "#f0fff4" : "#fff3f3",
            border: `1px solid ${statusMsg.ok ? "#68d391" : "#e0a0a0"}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 16,
          }}>
            <span style={{ color: statusMsg.ok ? "#276749" : "#a00", fontSize: 13 }}>{statusMsg.text}</span>
            <button className="secondary" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => setStatusMsg(null)}>✕</button>
          </div>
        )}

        {showMerge ? (
          <div className="card">
            <h2 className="section-title">Merge Clients</h2>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Reassigns all records from the source to the target, then removes the source.
              Use this to consolidate duplicate or inconsistently named entries. This cannot be undone.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Source (will be removed)</label>
                <select value={mergeSourceId} onChange={(e) => setMergeSourceId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— select source —</option>
                  {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Target (keep this one)</label>
                <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— select target —</option>
                  {active.filter((c) => c.id !== mergeSourceId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {mergeSourceId && mergeTargetId && mergeSourceId !== mergeTargetId && (
              <div style={{ background: "#fff8e1", border: "1px solid #e0c840", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#7a5f00" }}>
                All records referencing <strong>{clients.find((c) => c.id === mergeSourceId)?.name}</strong> will be
                reassigned to <strong>{clients.find((c) => c.id === mergeTargetId)?.name}</strong> across quotes,
                invoices, job sheets, job requests, calendar events, job costing, and rate cards.
              </div>
            )}
            <div className="action-row">
              <button
                onClick={runMerge}
                disabled={!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId || merging}
                style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }}
              >
                {merging ? "Merging…" : "Merge"}
              </button>
              <button className="secondary" onClick={() => setShowMerge(false)}>Cancel</button>
            </div>
          </div>
        ) : selectedClient ? (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                {selectedClient.name || "New Client"}
              </h2>
              {dirty && (
                <span style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>Unsaved changes</span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Client Name *</label>
                <input
                  value={selectedClient.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="Client / Company name"
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Contact Name</label>
                <input
                  value={selectedClient.contactName ?? ""}
                  onChange={(e) => updateField("contactName", e.target.value)}
                  placeholder="Primary contact"
                  style={{ width: "100%" }}
                />
              </div>

              {selectedClient.billTo && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#888" }}>
                    Historical Billing Address <span style={{ fontStyle: "italic" }}>(read-only — seeded from invoices)</span>
                  </label>
                  <pre style={{
                    margin: 0, padding: "10px 14px", background: "var(--surface2, #f9fafb)",
                    border: "1px solid var(--border, #e5e7eb)", borderRadius: 6,
                    fontSize: 13, fontFamily: "inherit", whiteSpace: "pre-wrap", color: "#555",
                  }}>
                    {selectedClient.billTo}
                  </pre>
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Email</label>
                <input
                  type="email"
                  value={selectedClient.email ?? ""}
                  onChange={(e) => updateField("email", e.target.value)}
                  placeholder="email@example.com"
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Phone</label>
                <input
                  value={selectedClient.phone ?? ""}
                  onChange={(e) => updateField("phone", e.target.value)}
                  placeholder="(555) 555-5555"
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Address</label>
                <input
                  value={selectedClient.address ?? ""}
                  onChange={(e) => updateField("address", e.target.value)}
                  placeholder="Street address"
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>City</label>
                <input
                  value={selectedClient.city ?? ""}
                  onChange={(e) => updateField("city", e.target.value)}
                  placeholder="City"
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>State</label>
                  <input
                    value={selectedClient.state ?? ""}
                    onChange={(e) => updateField("state", e.target.value)}
                    placeholder="ST"
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Zip</label>
                  <input
                    value={selectedClient.zip ?? ""}
                    onChange={(e) => updateField("zip", e.target.value)}
                    placeholder="00000"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Notes</label>
                <textarea
                  value={selectedClient.notes ?? ""}
                  onChange={(e) => updateField("notes", e.target.value)}
                  placeholder="Internal notes…"
                  rows={3}
                  style={{ width: "100%", resize: "vertical" }}
                />
              </div>
            </div>

            <div className="action-row" style={{ marginTop: 20 }}>
              <button onClick={saveForm} disabled={!dirty || !selectedClient.name.trim() || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              {dirty && (
                <button className="secondary" onClick={cancelEdit}>Cancel</button>
              )}
            </div>
          </div>
        ) : (
          <div className="card" style={{ color: "#888", textAlign: "center", padding: "40px 20px" }}>
            Select a client from the list, or click <strong>+ New</strong> to add one.
          </div>
        )}
      </div>
    </div>
  );
}
