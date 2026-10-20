"use client";

// Onboarding (backlog #120). Admin-only: everyone on a confirmed crew
// assignment or timesheet from 30 days back to 30 days ahead with no
// Payroll ID. Fix email/phone and Employee/Contractor here, merge AOS
// duplicates, link an existing Paychex worker, or send a new one to
// Paychex so Paychex emails them the self-onboarding invite.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { mergeEmployees, patchEmployeeFields } from "@/lib/store/db";
import { canSend, defaultKeep, type DupMatch, type OnboardingRow, type PaychexMatch } from "@/lib/onboarding/plan";
import type { SendOutcome } from "@/lib/onboarding/send";

// The send API takes at most 15 people per request.
const CHUNK = 15;

async function api(path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const fmtDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const MISSING: React.CSSProperties = { borderColor: "#d9534f", background: "#fff5f5" };

function EditCell({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => Promise<boolean> }) {
  const [v, setV] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      placeholder={placeholder}
      disabled={saving}
      style={{ minWidth: 170, ...(v.trim() ? {} : MISSING) }}
      onChange={(e) => setV(e.target.value)}
      onBlur={async () => {
        if (v.trim() === value.trim()) return;
        setSaving(true);
        if (!(await onSave(v))) setV(value);
        setSaving(false);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

type MergePick = { row: OnboardingRow; dup: DupMatch };

function MergeDialog({ pick, onClose, onDone }: { pick: MergePick; onClose: () => void; onDone: () => void }) {
  const { row, dup } = pick;
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [keep, setKeep] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const c: Record<string, number> = {};
      for (const k of [row.employeeKey, dup.employeeKey]) {
        const { count } = await supabase.from("timesheet_entries").select("id", { count: "exact", head: true }).eq("employee_key", k);
        c[k] = count ?? 0;
      }
      setCounts(c);
      setKeep(defaultKeep(
        { employeeKey: row.employeeKey, payrollId: row.payrollId, entries: c[row.employeeKey] },
        { employeeKey: dup.employeeKey, payrollId: dup.payrollId, entries: c[dup.employeeKey] },
      ));
    })();
  }, [row, dup]);

  const side = (key: string, name: string, payrollId: number | null, email: string, phone: string) => (
    <label className="card" style={{ flex: 1, cursor: "pointer", outline: keep === key ? "2px solid var(--gold-dark)" : undefined }}>
      <input type="radio" name="keep" checked={keep === key} onChange={() => setKeep(key)} /> <b>Keep</b>
      <div style={{ marginTop: 8 }}><b>{name}</b></div>
      <div className="muted" style={{ fontSize: 13 }}>
        {payrollId != null ? `Payroll ID ${payrollId}` : "No Payroll ID"}<br />
        {email || "no email"} · {phone || "no phone"}<br />
        {counts ? `${counts[key]} timesheet entries` : "…"}<br />
        <small>{key}</small>
      </div>
    </label>
  );

  async function run() {
    const dupKey = keep === row.employeeKey ? dup.employeeKey : row.employeeKey;
    setBusy(true); setError(null);
    const { error } = await mergeEmployees(dupKey, keep);
    setBusy(false);
    if (error) { setError(error); return; }
    onDone();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ width: "min(640px,95vw)" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Merge records</h3>
        <div className="action-row" style={{ gap: 12, alignItems: "stretch" }}>
          {side(row.employeeKey, row.name, row.payrollId, row.email, row.phone)}
          {side(dup.employeeKey, dup.name, dup.payrollId, dup.email, dup.phone)}
        </div>
        {error && <div style={{ color: "#b00", marginTop: 8 }}>{error}</div>}
        <div className="action-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={run} disabled={busy || !keep || !counts}
            title="Moves all crew assignments, timesheets and payroll entries to the kept record, then deletes the other one (a backup is kept)">
            {busy ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const [rows, setRows] = useState<OnboardingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [px, setPx] = useState<Record<string, PaychexMatch[]> | null>(null);
  const [pxBusy, setPxBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [merge, setMerge] = useState<MergePick | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const r = await api("/api/onboarding");
    if (!r.ok) { setError(r.json?.error ?? `HTTP ${r.status}`); return; }
    setRows(r.json.rows);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function checkPaychex() {
    if (!rows?.length) return;
    setPxBusy(true); setError(null);
    const r = await api("/api/onboarding/paychex", "POST", { keys: rows.map((x) => x.employeeKey) });
    setPxBusy(false);
    if (!r.ok) { setError(r.json?.error ?? `HTTP ${r.status}`); return; }
    setPx(r.json.matches);
  }

  const update = (key: string, patch: Partial<OnboardingRow>) =>
    setRows((rs) => rs?.map((x) => (x.employeeKey === key ? { ...x, ...patch } : x)) ?? rs);

  async function saveField(row: OnboardingRow, field: "email" | "phone", value: string) {
    const { error } = await patchEmployeeFields(row.employeeKey, { [field]: value });
    if (error) { alert(`Couldn't save: ${(error as any)?.message ?? error}`); return false; }
    update(row.employeeKey, { [field]: value.trim() });
    return true;
  }

  async function toggleType(row: OnboardingRow) {
    const next = row.employmentType === "Employee" ? "Contractor" : "Employee";
    setBusyKey(row.employeeKey);
    const { error } = await patchEmployeeFields(row.employeeKey, { employmentType: next });
    setBusyKey(null);
    if (error) { alert(`Couldn't save: ${(error as any)?.message ?? error}`); return; }
    update(row.employeeKey, { employmentType: next });
  }

  async function notSame(row: OnboardingRow, dup: DupMatch) {
    const r = await api("/api/onboarding/not-same", "POST", { a: row.employeeKey, b: dup.employeeKey });
    if (!r.ok) { alert(r.json?.error ?? "Couldn't save"); return; }
    update(row.employeeKey, { duplicates: row.duplicates.filter((d) => d.employeeKey !== dup.employeeKey) });
  }

  async function useId(row: OnboardingRow, m: PaychexMatch) {
    if (!confirm(`Give ${row.name} Payroll ID ${m.payrollId} (${m.name} in Paychex)?`)) return;
    setBusyKey(row.employeeKey);
    const r = await api("/api/onboarding/use-id", "POST", { employeeKey: row.employeeKey, workerId: m.workerId });
    setBusyKey(null);
    if (!r.ok) { alert(r.json?.error ?? "Couldn't link"); return; }
    setRows((rs) => rs?.filter((x) => x.employeeKey !== row.employeeKey) ?? rs);
  }

  // Apply what the server says happened to each person.
  function applyOutcomes(results: SendOutcome[]) {
    for (const r of results) {
      if (r.kind === "sent") {
        if (r.payrollId != null) setRows((rs) => rs?.filter((x) => x.employeeKey !== r.employeeKey) ?? rs);
        else update(r.employeeKey, { paychexWorkerId: r.workerId, paychexInvitedAt: new Date().toISOString() });
      } else if (r.kind === "needsConfirm") {
        setPx((p) => ({ ...(p ?? {}), [r.employeeKey]: r.matches }));
      }
    }
  }

  function summary(results: SendOutcome[]): string {
    const lines: string[] = [];
    const sent = results.filter((r) => r.kind === "sent");
    const dry = results.filter((r) => r.kind === "dryRun");
    const held = results.filter((r) => r.kind === "needsConfirm");
    const failed = results.filter((r) => r.kind === "error");
    if (dry.length) lines.push(`Preview only — nothing was sent to Paychex (${dry.length}). Sending works on the live site.`);
    if (sent.length) lines.push(`Sent: ${sent.length}`);
    const noEmail = sent.filter((r) => r.kind === "sent" && !r.emailOnFile);
    if (noEmail.length) lines.push(`Paychex shows no email on these, so the invite may not have gone out. Check them in Flex:\n${noEmail.map((r) => `• ${r.name}`).join("\n")}`);
    if (held.length) lines.push(`Not sent — Paychex may already have them. Check the Paychex column and send them one at a time:\n${held.map((r) => `• ${r.name}`).join("\n")}`);
    if (failed.length) lines.push(`Failed:\n${failed.map((r) => `• ${r.name}: ${r.kind === "error" ? r.error : ""}`).join("\n")}`);
    return lines.join("\n\n");
  }

  async function postSend(keys: string[], ignoreMatches = false): Promise<SendOutcome[] | null> {
    const r = await api("/api/onboarding/send", "POST", { employeeKeys: keys, ignoreMatches });
    if (!r.ok) { alert(r.json?.error ?? "Send failed"); return null; }
    return r.json.results as SendOutcome[];
  }

  const typeLabel = (t: string) => (t === "Employee" ? "Employee (W-2)" : "Contractor (1099)");

  async function send(row: OnboardingRow) {
    if (!confirm(`Send to Paychex?\n\n${row.name}\n${row.email}\n${typeLabel(row.employmentType)}\n\nPaychex will email them an onboarding invite.`)) return;
    setBusyKey(row.employeeKey);
    let results = await postSend([row.employeeKey]);
    const held = results?.[0];
    if (held?.kind === "needsConfirm") {
      applyOutcomes(results!);
      const list = held.matches.map((m) => `• ${m.name}${m.payrollId != null ? ` #${m.payrollId}` : ""} (${m.status.toLowerCase()}) — ${m.reason}`).join("\n");
      results = confirm(`Paychex may already have this person:\n\n${list}\n\nSend a new worker anyway?`)
        ? await postSend([row.employeeKey], true) : null;
    }
    setBusyKey(null);
    if (!results) return;
    applyOutcomes(results);
    const r = results[0];
    if (r.kind !== "sent" || !r.emailOnFile) alert(summary(results));
    if (r.kind === "error" && r.unknown) load();
  }

  async function sendSelected() {
    const list = (rows ?? []).filter((x) => picked.has(x.employeeKey) && canSend(x));
    if (!list.length) return;
    if (!confirm(`Send ${list.length} to Paychex?\n\n${list.map((x) => `• ${x.name} — ${x.email} — ${typeLabel(x.employmentType)}`).join("\n")}\n\nPaychex will email each of them an onboarding invite. Anyone Paychex may already have is skipped.`)) return;
    setBatchBusy(true);
    const all: SendOutcome[] = [];
    for (let i = 0; i < list.length; i += CHUNK) {
      const results = await postSend(list.slice(i, i + CHUNK).map((x) => x.employeeKey));
      if (!results) break;
      applyOutcomes(results);
      all.push(...results);
    }
    setBatchBusy(false);
    setPicked(new Set());
    if (all.length) alert(summary(all));
    if (all.some((r) => r.kind === "error" && r.unknown)) load();
  }

  function paychexCell(row: OnboardingRow) {
    const sent = row.paychexInvitedAt
      ? <div><span className="pill pill-green">Sent {fmtDate(row.paychexInvitedAt.slice(0, 10))}</span></div>
      : null;
    const matches = px?.[row.employeeKey];
    if (!matches) return sent ?? <span className="muted">—</span>;
    if (!matches.length) return sent ?? <span className="muted">Not in Paychex</span>;
    return (
      <>
        {sent}
        {matches.map((m) => (
          <div key={m.workerId} style={{ fontSize: 13, whiteSpace: "nowrap" }}>
            {m.name}{m.payrollId != null ? ` #${m.payrollId}` : ""}{" "}
            <span className="muted">· {m.status.toLowerCase()} · {m.reason}</span>{" "}
            {m.payrollId != null && (
              <button className="secondary" disabled={busyKey === row.employeeKey} onClick={() => useId(row, m)}>Use ID</button>
            )}
          </div>
        ))}
      </>
    );
  }

  if (error && !rows) return <div className="card"><div style={{ color: "#b00" }}>{error}</div></div>;
  if (!rows) return <div className="card"><div className="muted">Loading…</div></div>;

  const sendable = rows.filter(canSend);
  const allPicked = sendable.length > 0 && sendable.every((x) => picked.has(x.employeeKey));
  const togglePick = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="card">
      <div className="action-row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{rows.length} without a Payroll ID</h3>
        <span>
          <button onClick={sendSelected} disabled={batchBusy || !sendable.some((x) => picked.has(x.employeeKey))}>
            {batchBusy ? "Sending…" : `Send selected (${sendable.filter((x) => picked.has(x.employeeKey)).length})`}
          </button>{" "}
          <button className="secondary" onClick={load}>Refresh</button>{" "}
          <button onClick={checkPaychex} disabled={pxBusy || !rows.length} title="Look each person up in Paychex">
            {pxBusy ? "Checking Paychex…" : "Check Paychex"}
          </button>
        </span>
      </div>
      {error && <div style={{ color: "#b00", marginTop: 8 }}>{error}</div>}
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allPicked} disabled={!sendable.length} title="Select everyone who can be sent"
                  onChange={() => setPicked(allPicked ? new Set() : new Set(sendable.map((x) => x.employeeKey)))} />
              </th>
              <th>Name</th><th>Email</th><th>Phone</th><th>Type</th><th>Worked</th><th>Hours</th>
              <th>AOS duplicates</th><th>Paychex</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeKey}>
                <td>
                  <input type="checkbox" checked={picked.has(row.employeeKey)} disabled={!canSend(row)}
                    onChange={() => togglePick(row.employeeKey)} />
                </td>
                <td><Link href={`/employee-directory/${encodeURIComponent(row.employeeKey)}`}>{row.name}</Link></td>
                <td><EditCell value={row.email} placeholder="email" onSave={(v) => saveField(row, "email", v)} /></td>
                <td><EditCell value={row.phone} placeholder="phone" onSave={(v) => saveField(row, "phone", v)} /></td>
                <td>
                  <button className="secondary" disabled={busyKey === row.employeeKey} onClick={() => toggleType(row)}
                    title="Click to switch Employee (W-2) / Contractor (1099)">
                    {row.employmentType === "Employee" ? "Employee" : "Contractor"}
                  </button>
                </td>
                <td style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                  {row.lastWorked && <div>{fmtDate(row.lastWorked.date)} · {row.lastWorked.jobName}</div>}
                  {row.nextBooked && <div className="muted">Next {fmtDate(row.nextBooked.date)} · {row.nextBooked.jobName}</div>}
                </td>
                <td>{row.hours || ""}</td>
                <td>
                  {row.duplicates.slice(0, 3).map((d) => (
                    <div key={d.employeeKey} style={{ fontSize: 13, whiteSpace: "nowrap", opacity: d.strong ? 1 : 0.75 }}>
                      {d.name}{d.payrollId != null ? ` #${d.payrollId}` : ""} <span className="muted">· {d.reason}</span>{" "}
                      <button className="secondary" onClick={() => setMerge({ row, dup: d })}>Merge</button>{" "}
                      <button className="secondary" onClick={() => notSame(row, d)} title="Not the same person — stop flagging this pair">Not same</button>
                    </div>
                  ))}
                  {row.duplicates.length > 3 && <small className="muted">+{row.duplicates.length - 3} more</small>}
                </td>
                <td>{paychexCell(row)}</td>
                <td>
                  <button
                    disabled={!canSend(row) || busyKey === row.employeeKey || batchBusy}
                    title={row.paychexWorkerId ? "Already sent" : canSend(row) ? "Create in Paychex and email the onboarding invite" : "Needs an email"}
                    onClick={() => send(row)}
                  >
                    {busyKey === row.employeeKey ? "…" : "Send to Paychex"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {merge && <MergeDialog pick={merge} onClose={() => setMerge(null)} onDone={() => { setMerge(null); load(); }} />}
    </div>
  );
}
