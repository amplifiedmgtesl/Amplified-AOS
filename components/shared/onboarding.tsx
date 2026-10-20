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

  async function send(row: OnboardingRow, ignoreMatches = false) {
    if (!ignoreMatches && !confirm(
      `Send to Paychex?\n\n${row.name}\n${row.email}\n${row.employmentType === "Employee" ? "Employee (W-2)" : "Contractor (1099)"}\n\nPaychex will email them an onboarding invite.`,
    )) return;
    setBusyKey(row.employeeKey);
    const r = await api("/api/onboarding/send", "POST", { employeeKey: row.employeeKey, ignoreMatches });
    setBusyKey(null);
    if (r.status === 409 && r.json?.needsConfirm) {
      const list = (r.json.matches as PaychexMatch[]).map((m) => `• ${m.name}${m.payrollId != null ? ` #${m.payrollId}` : ""} (${m.status.toLowerCase()}) — ${m.reason}`).join("\n");
      setPx((p) => ({ ...(p ?? {}), [row.employeeKey]: r.json.matches }));
      if (confirm(`Paychex may already have this person:\n\n${list}\n\nSend a new worker anyway?`)) await send(row, true);
      return;
    }
    if (!r.ok) { alert(r.json?.error ?? "Send failed"); load(); return; }
    if (r.json.dryRun) { alert("Preview only — nothing was sent to Paychex. Sending works on the live site."); return; }
    if (!r.json.emailOnFile) alert("Created in Paychex, but Paychex shows no email on the worker — the invite may not have gone out. Check the worker in Flex.");
    if (r.json.payrollId != null) setRows((rs) => rs?.filter((x) => x.employeeKey !== row.employeeKey) ?? rs);
    else update(row.employeeKey, { paychexWorkerId: r.json.workerId, paychexInvitedAt: new Date().toISOString() });
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

  return (
    <div className="card">
      <div className="action-row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{rows.length} without a Payroll ID</h3>
        <span>
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
              <th>Name</th><th>Email</th><th>Phone</th><th>Type</th><th>Worked</th><th>Hours</th>
              <th>AOS duplicates</th><th>Paychex</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeKey}>
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
                    disabled={!canSend(row) || busyKey === row.employeeKey}
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
