"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { upsertCustomer, mergeCustomers } from "@/lib/store/app-store";
import type { Customer } from "@/lib/store/types";

async function fetchCustomers(): Promise<{ customers: Customer[]; error: string | null }> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("name");
  if (error) return { customers: [], error: error.message };
  const customers = (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, billTo: r.bill_to ?? "", email: r.email ?? "",
    phone: r.phone ?? "", address: r.address ?? "", city: r.city ?? "",
    state: r.state ?? "", notes: r.notes ?? "", isActive: r.is_active,
  }));
  return { customers, error: null };
}

type EditState = Partial<Customer> & { id: string };

export default function CustomerMaintenance() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [newName, setNewName] = useState("");
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Merge state
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);

  async function reload() {
    setLoading(true);
    setFetchError(null);
    const { customers, error } = await fetchCustomers();
    setCustomers(customers);
    setFetchError(error);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  const active = customers.filter((c) => c.isActive);
  const filtered = active.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  function startEdit(c: Customer) {
    setEditingId(c.id);
    setEditState({ ...c });
  }

  async function saveEdit() {
    if (!editState || !editState.name?.trim()) return;
    upsertCustomer({ ...editState, name: editState.name.trim(), isActive: true } as Customer);
    setEditingId(null);
    setEditState(null);
    setStatusMsg({ text: "Customer saved.", ok: true });
    await reload();
  }

  async function addCustomer() {
    if (!newName.trim()) return;
    const id = `cust-${Date.now()}`;
    upsertCustomer({ id, name: newName.trim(), isActive: true });
    setNewName("");
    setStatusMsg({ text: "Customer added.", ok: true });
    await reload();
  }

  async function runMerge() {
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) return;
    const source = customers.find((c) => c.id === mergeSourceId);
    const target = customers.find((c) => c.id === mergeTargetId);
    if (!source || !target) return;
    setMerging(true);
    const err = await mergeCustomers(mergeSourceId, mergeTargetId);
    setMerging(false);
    if (err) {
      setStatusMsg({ text: err, ok: false });
    } else {
      setStatusMsg({ text: `Merged "${source.name}" into "${target.name}". All records reassigned.`, ok: true });
      setMergeSourceId("");
      setMergeTargetId("");
      await reload();
    }
  }

  return (
    <div className="grid">
      {statusMsg && (
        <div className="card" style={{ background: statusMsg.ok ? "#f0fff4" : "#fff3f3", border: `1px solid ${statusMsg.ok ? "#68d391" : "#e0a0a0"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: statusMsg.ok ? "#276749" : "#a00", fontSize: 13 }}>{statusMsg.text}</span>
          <button className="secondary" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => setStatusMsg(null)}>✕</button>
        </div>
      )}

      {/* Customer list */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            {loading ? "Loading…" : `${active.length} Customer${active.length !== 1 ? "s" : ""}`}
          </h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ width: 200 }}
          />
        </div>

        {fetchError && (
          <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "10px 14px", color: "#a00", marginBottom: 12, fontSize: 13 }}>
            <strong>Error:</strong> {fetchError}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Phone</th><th>City / State</th><th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  {editingId === c.id && editState ? (
                    <>
                      <td><input value={editState.name ?? ""} onChange={(e) => setEditState({ ...editState, name: e.target.value })} autoFocus style={{ width: "100%" }} /></td>
                      <td><input value={editState.email ?? ""} onChange={(e) => setEditState({ ...editState, email: e.target.value })} placeholder="Email" style={{ width: "100%" }} /></td>
                      <td><input value={editState.phone ?? ""} onChange={(e) => setEditState({ ...editState, phone: e.target.value })} placeholder="Phone" style={{ width: "100%" }} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <input value={editState.city ?? ""} onChange={(e) => setEditState({ ...editState, city: e.target.value })} placeholder="City" style={{ flex: 1 }} />
                          <input value={editState.state ?? ""} onChange={(e) => setEditState({ ...editState, state: e.target.value })} placeholder="ST" style={{ width: 48 }} />
                        </div>
                      </td>
                      <td>
                        <div className="action-row">
                          <button onClick={saveEdit}>Save</button>
                          <button className="secondary" onClick={() => { setEditingId(null); setEditState(null); }}>Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td><strong>{c.name}</strong></td>
                      <td>{c.email || <span className="muted">—</span>}</td>
                      <td>{c.phone || <span className="muted">—</span>}</td>
                      <td>{[c.city, c.state].filter(Boolean).join(", ") || <span className="muted">—</span>}</td>
                      <td>
                        <button className="secondary" onClick={() => startEdit(c)}>Edit</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: "center" }}>No customers found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add customer */}
      <div className="card">
        <h2 className="section-title">Add Customer</h2>
        <div className="action-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustomer(); }}
            placeholder="Customer name…"
            style={{ flex: 1 }}
          />
          <button onClick={addCustomer} disabled={!newName.trim()}>Add</button>
        </div>
      </div>

      {/* Merge */}
      <div className="card">
        <h2 className="section-title">Merge Customers</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          Reassigns all records from the source customer to the target, then removes the source.
          Use this to consolidate duplicate or inconsistently named entries.
        </p>
        <div className="grid4" style={{ marginBottom: 14 }}>
          <div>
            <small>Source (will be removed)</small>
            <select value={mergeSourceId} onChange={(e) => setMergeSourceId(e.target.value)}>
              <option value="">— select source —</option>
              {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <small>Target (keep this one)</small>
            <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
              <option value="">— select target —</option>
              {active.filter((c) => c.id !== mergeSourceId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {mergeSourceId && mergeTargetId && mergeSourceId !== mergeTargetId && (
          <div style={{ background: "#fff8e1", border: "1px solid #e0c840", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#7a5f00" }}>
            All records referencing <strong>{customers.find((c) => c.id === mergeSourceId)?.name}</strong> will be
            reassigned to <strong>{customers.find((c) => c.id === mergeTargetId)?.name}</strong> across quotes,
            invoices, job sheets, job requests, calendar events, job costing, and rate cards.
            This cannot be undone.
          </div>
        )}
        <button
          onClick={runMerge}
          disabled={!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId || merging}
          style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }}
        >
          {merging ? "Merging…" : "Merge"}
        </button>
      </div>
    </div>
  );
}
