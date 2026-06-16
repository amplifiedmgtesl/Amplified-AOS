"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { mergeClients } from "@/lib/store/app-store";
import type { Client } from "@/lib/store/types";

async function fetchClients(): Promise<{ clients: Client[]; error: string | null }> {
  const { data, error } = await supabase.from("clients").select("*").order("name");
  if (error) return { clients: [], error: error.message };
  const clients = (data ?? []).map((r: any) => ({
    id: r.id, name: r.name ?? "", code: r.code ?? "",
    contactName: r.contact_name ?? "",
    billTo: r.bill_to ?? "", email: r.email ?? "", phone: r.phone ?? "",
    address: r.address ?? "", city: r.city ?? "", state: r.state ?? "",
    zip: r.zip ?? "", notes: r.notes ?? "", isActive: r.is_active,
  }));
  return { clients, error: null };
}

/**
 * Client maintenance — the full-width searchable list. Selecting a row opens
 * the client on its own route (/clients/{id}), mirroring the quotes/invoices
 * list→detail flow. Merge stays here as a cross-client (list-level) action.
 */
export default function ClientMaintenance() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState<"active" | "inactive" | "all">("active");
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
  const inactive = clients.filter((c) => !c.isActive);
  const visible =
    showInactive === "active" ? active :
    showInactive === "inactive" ? inactive :
    clients;
  const filtered = visible.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.contactName ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.code ?? "").toLowerCase().includes(search.toLowerCase())
  );

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
      await reload();
    }
  }

  return (
    <div className="grid">
      {statusMsg && (
        <div className="card" style={{
          background: statusMsg.ok ? "#f0fff4" : "#fff3f3",
          border: `1px solid ${statusMsg.ok ? "#68d391" : "#e0a0a0"}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ color: statusMsg.ok ? "#276749" : "#a00", fontSize: 13 }}>{statusMsg.text}</span>
          <button className="secondary" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => setStatusMsg(null)}>✕</button>
        </div>
      )}

      <div className="card">
        <div className="action-row" style={{ marginBottom: 12, gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0, flex: 1 }}>Clients</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / contact / code…"
            style={{ minWidth: 240 }}
          />
          <Link href="/clients/new" style={{
            textDecoration: "none", padding: "8px 14px", borderRadius: 6,
            background: "var(--accent, #2563eb)", color: "#fff", fontSize: 13, fontWeight: 600,
          }}>+ New Client</Link>
          <button className="secondary" onClick={() => setShowMerge((v) => !v)}>
            {showMerge ? "Close Merge" : "Merge Clients"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12, fontSize: 12 }}>
          {(["active", "inactive", "all"] as const).map((opt) => {
            const count = opt === "active" ? active.length : opt === "inactive" ? inactive.length : clients.length;
            const isOn = showInactive === opt;
            return (
              <button
                key={opt}
                onClick={() => setShowInactive(opt)}
                className="secondary"
                style={{
                  padding: "4px 12px", fontSize: 12, textTransform: "capitalize",
                  background: isOn ? "var(--accent, #2563eb)" : "transparent",
                  color: isOn ? "#fff" : "inherit",
                  border: `1px solid ${isOn ? "var(--accent, #2563eb)" : "var(--border, #e5e7eb)"}`,
                }}
              >
                {opt} ({count})
              </button>
            );
          })}
        </div>

        {fetchError && (
          <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "8px 12px", color: "#a00", marginBottom: 10, fontSize: 13 }}>
            {fetchError}
          </div>
        )}

        {showMerge && (
          <div className="card" style={{ background: "var(--surface2, #f9fafb)", marginBottom: 16 }}>
            <h3 className="section-title">Merge Clients</h3>
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
        )}

        <div className="muted" style={{ marginBottom: 8 }}>
          {filtered.length} of {clients.length} client{clients.length !== 1 ? "s" : ""}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Contact</th><th>City</th><th>State</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="muted">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="muted">No clients found.</td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{c.code || "—"}</td>
                  <td>
                    <Link href={`/clients/${encodeURIComponent(c.id)}`} style={{ color: "#2c4d73", textDecoration: "underline", fontWeight: 600 }}>
                      {c.name || "—"}
                    </Link>
                  </td>
                  <td>{c.contactName || "—"}</td>
                  <td>{c.city || "—"}</td>
                  <td>{c.state || "—"}</td>
                  <td>
                    {c.isActive
                      ? <span className="badge">Active</span>
                      : <span className="badge secondary">Inactive</span>}
                  </td>
                  <td>
                    <Link href={`/clients/${encodeURIComponent(c.id)}`} className="secondary" style={{ textDecoration: "none", padding: "4px 10px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, fontSize: 13 }}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
