"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { upsertClient, mergeClients } from "@/lib/store/app-store";
import type { Client } from "@/lib/store/types";
import { US_STATES } from "@/lib/constants";
import { ClientContactsTab } from "./client-contacts-tab";

const EMPTY_CLIENT: Omit<Client, "id"> = {
  name: "", code: "", contactName: "", billTo: "", email: "", phone: "",
  address: "", city: "", state: "", zip: "", notes: "", isActive: true,
};

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

function newId() { return `clt-${Date.now()}`; }

export default function ClientMaintenance() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState<"active" | "inactive" | "all">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Client | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"contacts" | "job_requests" | "quotes" | "rate_cards" | "calendar_events" | "invoices">("contacts");
  const [tabData, setTabData] = useState<{
    jobRequests: any[];
    quotes: any[];
    quoteDraftCount: number;
    rateCards: any[];
    calendarEvents: any[];
    invoices: any[];
  } | null>(null);
  const [contactsCount, setContactsCount] = useState(0);
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

  useEffect(() => {
    setContactsCount(0);
    if (!selectedId) { setTabData(null); return; }
    Promise.all([
      supabase.from("job_requests")
        // NOTE: linked_quote_id was dropped in migration 20260505b. Status pill
        // below derives "Quoted vs Pending" from job_requests.status instead.
        .select("id, job_no, event_name, received_date, request_date, end_date, venue, status")
        .eq("client_id", selectedId).order("request_date", { ascending: false, nullsFirst: false }),
      supabase.from("quotes")
        .select("id, event_name, start_date, end_date, status, total, job_request_id, quote_no, is_draft")
        .eq("client_id", selectedId).order("start_date", { ascending: false }),
      supabase.from("rate_card_profiles")
        .select("id, name, updated_at")
        .eq("client_id", selectedId).order("name"),
      supabase.from("calendar_events")
        .select("id, event_name, start_date, start_time, end_date, status")
        .eq("client_id", selectedId).eq("is_deleted", false)
        .order("start_date", { ascending: false }),
      supabase.from("invoices")
        .select("id, invoice_no, issue_date, event_name, subtotal, amount_due, paid_amount, status, job_request_id, invoice_type, is_draft")
        .eq("client_id", selectedId).order("issue_date", { ascending: false }),
    ]).then(([jrRes, quotesRes, rcRes, calRes, invRes]) => {
      // quote_draft_workspaces was dropped in migration 20260505b — drafts now
      // live as is_draft=true rows in quotes; counted from quotesRes below.
      setTabData({
        jobRequests: jrRes.data ?? [],
        quotes: quotesRes.data ?? [],
        quoteDraftCount: (quotesRes.data ?? []).filter((q: any) => q.is_draft).length,
        rateCards: rcRes.data ?? [],
        calendarEvents: calRes.data ?? [],
        invoices: invRes.data ?? [],
      });
    });
  }, [selectedId]);

  const active = clients.filter((c) => c.isActive);
  const inactive = clients.filter((c) => !c.isActive);
  const visible =
    showInactive === "active" ? active :
    showInactive === "inactive" ? inactive :
    clients;
  const filtered = visible.filter((c) =>
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

  async function requestDeactivate() {
    if (!form) return;
    const jrCount = tabData?.jobRequests.length ?? 0;
    const qCount = tabData?.quotes.length ?? 0;
    const qdCount = tabData?.quoteDraftCount ?? 0;
    const rcCount = tabData?.rateCards.length ?? 0;
    const calCount = tabData?.calendarEvents.length ?? 0;
    const invCount = tabData?.invoices.length ?? 0;
    const msgs: string[] = [];
    if (jrCount > 0) msgs.push(`${jrCount} job request${jrCount !== 1 ? "s" : ""}`);
    if (qCount > 0) msgs.push(`${qCount} quote${qCount !== 1 ? "s" : ""}`);
    if (qdCount > 0) msgs.push(`${qdCount} quote draft${qdCount !== 1 ? "s" : ""}`);
    if (rcCount > 0) msgs.push(`${rcCount} rate card${rcCount !== 1 ? "s" : ""}`);
    if (calCount > 0) msgs.push(`${calCount} calendar event${calCount !== 1 ? "s" : ""}`);
    if (invCount > 0) msgs.push(`${invCount} invoice${invCount !== 1 ? "s" : ""}`);
    if (msgs.length > 0) {
      setStatusMsg({ text: `Cannot deactivate — ${msgs.join(" and ")} reference this client.`, ok: false });
      return;
    }
    setConfirmDeactivateId(form.id);
  }

  async function confirmDeactivate() {
    if (!form || !confirmDeactivateId) return;
    upsertClient({ ...form, isActive: false });
    setConfirmDeactivateId(null);
    setSelectedId(null);
    setForm(null);
    setStatusMsg({ text: "Client deactivated.", ok: true });
    await reload();
  }

  async function saveForm() {
    if (!form || !form.name.trim()) return;
    const code = (form.code ?? "").trim().toUpperCase();
    if (code && code.length !== 3) {
      setStatusMsg({ text: "Client Code must be exactly 3 characters (or left blank).", ok: false });
      return;
    }
    if (code) {
      const conflict = clients.find(
        (c) => c.id !== form.id && c.isActive !== false && (c.code ?? "").toUpperCase() === code
      );
      if (conflict) {
        setStatusMsg({ text: `Code "${code}" is already used by "${conflict.name}". Pick a different code.`, ok: false });
        return;
      }
    }
    setSaving(true);
    upsertClient({ ...form, name: form.name.trim(), code: code || undefined });
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

  // Group quotes/invoices/calendar by job_request so each tab can render
  // a per-job section instead of a flat list. Jobs list comes from
  // tabData.jobRequests (already sorted by request_date desc), so groups
  // come out in most-recent-first order naturally. Items whose job link
  // is missing OR points to a job that doesn't belong to this client land
  // in `orphans` (rendered as "Other / Unlinked" at the bottom).
  function groupByJob<T>(
    items: T[],
    getJobId: (it: T) => string | null | undefined,
  ): {
    groups: Array<{ job: any; items: T[] }>;
    orphans: T[];
  } {
    if (!tabData) return { groups: [], orphans: items };
    const jobsById = new Map(tabData.jobRequests.map((j: any) => [j.id, j]));
    const itemsByJob = new Map<string, T[]>();
    const orphans: T[] = [];
    for (const it of items) {
      const jid = getJobId(it);
      if (jid && jobsById.has(jid)) {
        const arr = itemsByJob.get(jid) ?? [];
        arr.push(it);
        itemsByJob.set(jid, arr);
      } else {
        orphans.push(it);
      }
    }
    const groups = tabData.jobRequests
      .filter((j: any) => itemsByJob.has(j.id))
      .map((j: any) => ({ job: j, items: itemsByJob.get(j.id)! }));
    return { groups, orphans };
  }

  /** Render a section-header row that spans every column of the
   *  enclosing table. Click jumps to the job request screen. */
  function jobHeaderRow(job: any, count: number, colSpan: number) {
    return (
      <tr
        key={`hdr-${job.id}`}
        onClick={() => { window.location.href = `/job-requests?id=${encodeURIComponent(job.id)}`; }}
        style={{
          background: "var(--surface2, #f7f4ee)",
          cursor: "pointer",
          borderTop: "2px solid var(--border, #d7c6aa)",
          borderBottom: "1px solid var(--border, #e5e7eb)",
        }}
        title="Open this job"
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#efe7d3"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface2, #f7f4ee)"; }}
      >
        <td colSpan={colSpan} style={{ padding: "6px 8px", fontSize: 12 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--accent, #2563eb)" }}>
            {job.job_no ?? "(no job #)"}
          </span>
          <span style={{ margin: "0 8px", color: "#999" }}>·</span>
          <strong>{job.event_name ?? "(untitled)"}</strong>
          {job.request_date && (
            <>
              <span style={{ margin: "0 8px", color: "#999" }}>·</span>
              <span style={{ color: "#666" }}>
                {job.request_date}{job.end_date && job.end_date !== job.request_date ? ` – ${job.end_date}` : ""}
              </span>
            </>
          )}
          <span style={{ float: "right", color: "#888", fontWeight: 500 }}>
            {count} item{count === 1 ? "" : "s"}
          </span>
        </td>
      </tr>
    );
  }

  /** Section header for orphan (unlinked) items. */
  function orphanHeaderRow(count: number, colSpan: number) {
    return (
      <tr
        key="hdr-orphans"
        style={{
          background: "#fff3e6",
          borderTop: "2px solid var(--border, #d7c6aa)",
          borderBottom: "1px solid var(--border, #e5e7eb)",
        }}
        title="Items not linked to any job request"
      >
        <td colSpan={colSpan} style={{ padding: "6px 8px", fontSize: 12, color: "#8a4d00" }}>
          <strong>⚠ Other / Unlinked</strong>
          <span style={{ color: "#888", marginLeft: 8, fontWeight: 400 }}>
            (no job_request_id — pre-rewrite legacy or test data)
          </span>
          <span style={{ float: "right", color: "#888", fontWeight: 500 }}>
            {count} item{count === 1 ? "" : "s"}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", height: "100%" }}>
      {/* ── Left: list ── */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            style={{ flex: 1 }}
          />
          <button onClick={startNew} title="Add new client" style={{ whiteSpace: "nowrap" }}>+ New</button>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 12, fontSize: 11 }}>
          {(["active", "inactive", "all"] as const).map((opt) => {
            const count = opt === "active" ? active.length : opt === "inactive" ? inactive.length : clients.length;
            const isOn = showInactive === opt;
            return (
              <button
                key={opt}
                onClick={() => setShowInactive(opt)}
                className="secondary"
                style={{
                  flex: 1, padding: "4px 6px", fontSize: 11, textTransform: "capitalize",
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
                <div style={{ fontWeight: 600 }}>
                  {c.code && <span style={{ fontFamily: "monospace", fontSize: 11, opacity: 0.7, marginRight: 6 }}>[{c.code}]</span>}
                  {c.name}
                </div>
                {c.contactName && <div style={{ fontSize: 12, opacity: 0.8 }}>{c.contactName}</div>}
              </button>
            ))
          )}
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            {active.length} client{active.length !== 1 ? "s" : ""}
          </div>
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
              <div>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Client Name *</label>
                <input
                  value={selectedClient.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="Client / Company name"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Client Code</label>
                <input
                  value={selectedClient.code ?? ""}
                  onChange={(e) => updateField("code", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  placeholder="e.g. JAY"
                  maxLength={3}
                  style={{ width: "100%", textTransform: "uppercase", fontFamily: "monospace" }}
                />
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Exactly 3 characters (letters/digits). Used as the prefix on quote display codes.
                </div>
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
                  <select
                    value={selectedClient.state ?? ""}
                    onChange={(e) => updateField("state", e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">— Select —</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
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

            {confirmDeactivateId === selectedClient.id && (
              <div style={{ background: "#fff8e1", border: "1px solid #e0c840", borderRadius: 8, padding: "10px 14px", marginTop: 16, fontSize: 13, color: "#7a5f00" }}>
                Deactivate <strong>{selectedClient.name}</strong>? They will no longer appear in dropdowns.
                <div className="action-row" style={{ marginTop: 8 }}>
                  <button style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }} onClick={confirmDeactivate}>Deactivate</button>
                  <button className="secondary" onClick={() => setConfirmDeactivateId(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="action-row" style={{ marginTop: 20 }}>
              <button onClick={saveForm} disabled={!dirty || !selectedClient.name.trim() || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              {dirty && (
                <button className="secondary" onClick={cancelEdit}>Cancel</button>
              )}
              {!dirty && selectedClient.id && selectedClient.isActive && (
                <button className="secondary" style={{ color: "#c00", marginLeft: "auto" }} onClick={requestDeactivate}>
                  Deactivate
                </button>
              )}
              {!dirty && selectedClient.id && !selectedClient.isActive && (
                <button
                  className="secondary"
                  style={{ color: "#06633a", marginLeft: "auto" }}
                  onClick={async () => {
                    if (!form) return;
                    await upsertClient({ ...form, isActive: true });
                    setStatusMsg({ text: "Client reactivated.", ok: true });
                    await reload();
                    setSelectedId(form.id);
                  }}
                >
                  Reactivate
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="card" style={{ color: "#888", textAlign: "center", padding: "40px 20px" }}>
            Select a client from the list, or click <strong>+ New</strong> to add one.
          </div>
        )}

        {tabData && (
          <div className="card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
            {/* Tab bar */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              {(["contacts", "job_requests", "quotes", "rate_cards", "calendar_events", "invoices"] as const).map((tab) => {
                const labels: Record<string, string> = { contacts: "Contacts", job_requests: "Jobs", quotes: "Quotes", rate_cards: "Rate Cards", calendar_events: "Calendar Events", invoices: "Invoices" };
                const counts: Record<string, number> = { contacts: contactsCount, job_requests: tabData.jobRequests.length, quotes: tabData.quotes.length, rate_cards: tabData.rateCards.length, calendar_events: tabData.calendarEvents.length, invoices: tabData.invoices.length };
                const active = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      flex: 1, padding: "10px 8px", border: "none", borderBottom: active ? "2px solid var(--accent, #2563eb)" : "2px solid transparent",
                      background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 400,
                      color: active ? "var(--accent, #2563eb)" : "#666", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    }}
                  >
                    {labels[tab]}
                    <span style={{
                      background: counts[tab] > 0 ? (active ? "var(--accent, #2563eb)" : "#e5e7eb") : "#e5e7eb",
                      color: counts[tab] > 0 && active ? "#fff" : "#555",
                      borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 600,
                    }}>{counts[tab]}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div style={{ padding: "12px 16px", maxHeight: 280, overflowY: "auto" }}>
              {activeTab === "contacts" && selectedId && (
                <ClientContactsTab clientId={selectedId} onCountChange={setContactsCount} />
              )}
              {activeTab === "job_requests" && (
                tabData.jobRequests.length === 0
                  ? <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No job requests.</div>
                  : <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ color: "#888", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Job #</th>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Event</th>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Venue</th>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tabData.jobRequests.map((r) => (
                          <tr
                            key={r.id}
                            onClick={() => { window.location.href = `/job-requests?id=${encodeURIComponent(r.id)}`; }}
                            style={{
                              borderBottom: "1px solid var(--border, #e5e7eb)",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface2, #f7f4ee)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                            title="Open this job"
                          >
                            <td style={{ padding: "5px 8px 5px 0", whiteSpace: "nowrap", fontFamily: "monospace", fontWeight: 600, color: "var(--accent, #2563eb)" }}>
                              {r.job_no ?? <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>—</span>}
                            </td>
                            <td style={{ padding: "5px 8px 5px 0" }} title={r.event_name ?? ""}>{r.event_name ?? "—"}</td>
                            <td style={{ padding: "5px 8px 5px 0" }}>{r.venue ?? "—"}</td>
                            <td style={{ padding: "5px 8px 5px 0", whiteSpace: "nowrap" }}>
                              {(() => {
                                const s = String(r.status ?? "lead").toLowerCase();
                                const palette: Record<string, { bg: string; fg: string }> = {
                                  lead:      { bg: "#fef9c3", fg: "#854d0e" },
                                  quoted:    { bg: "#e0f2fe", fg: "#0369a1" },
                                  booked:    { bg: "#dcfce7", fg: "#166534" },
                                  invoiced:  { bg: "#ede9fe", fg: "#5b21b6" },
                                  completed: { bg: "#dcfce7", fg: "#166534" },
                                  cancelled: { bg: "#f3f4f6", fg: "#555" },
                                };
                                const c = palette[s] ?? { bg: "#f3f4f6", fg: "#555" };
                                return (
                                  <span style={{ background: c.bg, color: c.fg, borderRadius: 4, padding: "2px 6px", fontSize: 11, textTransform: "capitalize" }}>
                                    {s}
                                  </span>
                                );
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
              )}

              {activeTab === "quotes" && (() => {
                if (tabData.quotes.length === 0) {
                  return <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No quotes.</div>;
                }
                const { groups, orphans } = groupByJob(tabData.quotes, (q: any) => q.job_request_id);
                const QUOTE_COLS = 5;
                const renderQuoteRow = (q: any) => (
                  <tr key={q.id} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                    <td style={{ padding: "5px 8px 5px 0", fontFamily: "monospace", fontSize: 11, color: "#555" }}>
                      {q.quote_no ?? (q.is_draft ? <em style={{ color: "#888" }}>(draft)</em> : "—")}
                    </td>
                    <td style={{ padding: "5px 8px 5px 0" }}>{q.event_name ?? "—"}</td>
                    <td style={{ padding: "5px 8px 5px 0", whiteSpace: "nowrap" }}>{q.start_date ?? "—"}{q.end_date && q.end_date !== q.start_date ? ` – ${q.end_date}` : ""}</td>
                    <td style={{ padding: "5px 8px 5px 0" }}>
                      <span style={{
                        background: q.is_draft ? "#fef3c7" : q.status === "signed" ? "#dcfce7" : q.status === "issued" ? "#e0f2fe" : q.status === "superseded" ? "#f3f4f6" : "#f3f4f6",
                        color:      q.is_draft ? "#92400e" : q.status === "signed" ? "#166534" : q.status === "issued" ? "#0369a1" : "#555",
                        borderRadius: 4, padding: "2px 6px", fontSize: 11,
                      }}>{q.is_draft ? "draft" : (q.status ?? "—")}</span>
                    </td>
                    <td style={{ padding: "5px 0", textAlign: "right", whiteSpace: "nowrap" }}>{q.total != null ? `$${Number(q.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}</td>
                  </tr>
                );
                return (
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: "#888", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                        <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Quote #</th>
                        <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Event</th>
                        <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Date</th>
                        <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Status</th>
                        <th style={{ textAlign: "right", padding: "4px 0 6px 0", fontWeight: 600 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(({ job, items }) => (
                        <React.Fragment key={job.id}>
                          {jobHeaderRow(job, items.length, QUOTE_COLS)}
                          {items.map(renderQuoteRow)}
                        </React.Fragment>
                      ))}
                      {orphans.length > 0 && (
                        <React.Fragment key="orphans">
                          {orphanHeaderRow(orphans.length, QUOTE_COLS)}
                          {orphans.map(renderQuoteRow)}
                        </React.Fragment>
                      )}
                    </tbody>
                  </table>
                );
              })()}

              {activeTab === "rate_cards" && (
                tabData.rateCards.length === 0
                  ? <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No rate cards.</div>
                  : <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ color: "#888", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Name</th>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Last Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tabData.rateCards.map((r) => (
                          <tr key={r.id} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                            <td style={{ padding: "5px 8px 5px 0" }}>{r.name ?? "Standard"}</td>
                            <td style={{ padding: "5px 8px 5px 0", color: "#888", whiteSpace: "nowrap" }}>{r.updated_at ? r.updated_at.slice(0, 10) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
              )}

              {activeTab === "calendar_events" && (
                tabData.calendarEvents.length === 0
                  ? <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No calendar events.</div>
                  : <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ color: "#888", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Date</th>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Time</th>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Event</th>
                          <th style={{ textAlign: "left", padding: "4px 8px 6px 0", fontWeight: 600 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tabData.calendarEvents.map((r) => (
                          <tr key={r.id} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                            <td style={{ padding: "5px 8px 5px 0", whiteSpace: "nowrap" }}>{r.start_date ?? "—"}{r.end_date && r.end_date !== r.start_date ? ` – ${r.end_date}` : ""}</td>
                            <td style={{ padding: "5px 8px 5px 0", whiteSpace: "nowrap" }}>{r.start_time ?? "—"}</td>
                            <td style={{ padding: "5px 8px 5px 0" }}>{r.event_name ?? "—"}</td>
                            <td style={{ padding: "5px 8px 5px 0", color: "#888" }}>{r.status ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
              )}

              {activeTab === "invoices" && (() => {
                if (tabData.invoices.length === 0) return <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No invoices.</div>;
                const currentYear = new Date().getFullYear().toString();
                const totalCount = tabData.invoices.length;
                const totalBilled = tabData.invoices.reduce((s, r) => s + Number(r.subtotal || 0), 0);
                const ytd = tabData.invoices.filter((r) => (r.issue_date ?? "").startsWith(currentYear));
                const ytdCount = ytd.length;
                const ytdBilled = ytd.reduce((s, r) => s + Number(r.subtotal || 0), 0);
                const outstanding = tabData.invoices.reduce((s, r) => s + Math.max(0, Number(r.amount_due || 0) - Number(r.paid_amount || 0)), 0);
                const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                const statBox = (label: string, value: string) => (
                  <div style={{ background: "#f9fafb", border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", color: "#888", letterSpacing: 0.4 }}>{label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{value}</div>
                  </div>
                );
                return (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 12 }}>
                      {statBox("Total Invoices", String(totalCount))}
                      {statBox("Total Billed", fmt(totalBilled))}
                      {statBox("YTD Invoices", String(ytdCount))}
                      {statBox("YTD Billed", fmt(ytdBilled))}
                      {statBox("Outstanding", fmt(outstanding))}
                    </div>
                    {(() => {
                      const { groups, orphans } = groupByJob(tabData.invoices, (r: any) => r.job_request_id);
                      const INV_COLS = 7;
                      const renderInvoiceRow = (r: any) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                          <td style={{ padding: "5px 8px 5px 0", fontFamily: "monospace", fontSize: 11 }}>
                            {r.invoice_no ?? (r.is_draft ? <em style={{ color: "#888" }}>(draft)</em> : "—")}
                          </td>
                          <td style={{ padding: "5px 8px 5px 0", fontSize: 10, color: "#666", textTransform: "uppercase" }}>{r.invoice_type ?? "—"}</td>
                          <td style={{ padding: "5px 8px 5px 0", whiteSpace: "nowrap" }}>{r.issue_date ?? "—"}</td>
                          <td style={{ padding: "5px 8px 5px 0" }}>{r.event_name ?? "—"}</td>
                          <td style={{ padding: "5px 8px 5px 0" }}>
                            <span style={{
                              background: r.is_draft ? "#fef3c7" : r.status === "paid" ? "#dcfce7" : r.status === "sent" ? "#e0f2fe" : r.status === "partial" ? "#fef3c7" : "#f3f4f6",
                              color:      r.is_draft ? "#92400e" : r.status === "paid" ? "#166534" : r.status === "sent" ? "#0369a1" : r.status === "partial" ? "#92400e" : "#555",
                              borderRadius: 4, padding: "2px 6px", fontSize: 11,
                            }}>{r.is_draft ? "draft" : (r.status ?? "—")}</span>
                          </td>
                          <td style={{ padding: "5px 0", textAlign: "right", whiteSpace: "nowrap" }}>{r.amount_due != null ? `$${Number(r.amount_due).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}</td>
                          <td style={{ padding: "5px 0", textAlign: "right", whiteSpace: "nowrap" }}>{r.paid_amount != null ? `$${Number(r.paid_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}</td>
                        </tr>
                      );
                      return (
                        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ color: "#888", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                              <th style={{ textAlign: "left",  padding: "4px 8px 6px 0", fontWeight: 600 }}>Invoice #</th>
                              <th style={{ textAlign: "left",  padding: "4px 8px 6px 0", fontWeight: 600 }}>Type</th>
                              <th style={{ textAlign: "left",  padding: "4px 8px 6px 0", fontWeight: 600 }}>Issue Date</th>
                              <th style={{ textAlign: "left",  padding: "4px 8px 6px 0", fontWeight: 600 }}>Event</th>
                              <th style={{ textAlign: "left",  padding: "4px 8px 6px 0", fontWeight: 600 }}>Status</th>
                              <th style={{ textAlign: "right", padding: "4px 0 6px 0",   fontWeight: 600 }}>Amount Due</th>
                              <th style={{ textAlign: "right", padding: "4px 0 6px 0",   fontWeight: 600 }}>Paid</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groups.map(({ job, items }) => (
                              <React.Fragment key={job.id}>
                                {jobHeaderRow(job, items.length, INV_COLS)}
                                {items.map(renderInvoiceRow)}
                              </React.Fragment>
                            ))}
                            {orphans.length > 0 && (
                              <React.Fragment key="orphans">
                                {orphanHeaderRow(orphans.length, INV_COLS)}
                                {orphans.map(renderInvoiceRow)}
                              </React.Fragment>
                            )}
                          </tbody>
                        </table>
                      );
                    })()}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
