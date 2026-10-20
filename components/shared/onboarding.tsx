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
import {
  canSend, defaultKeep, mergeConflicts, mergeOverrides,
  type DupMatch, type MergeField, type MergeSide, type OnboardingRow, type PaychexMatch,
} from "@/lib/onboarding/plan";
import type { SendOutcome } from "@/lib/onboarding/send";
import PaychexAsOf from "@/components/shared/paychex-as-of";
import { appliedDifferences } from "@/lib/jotform/application";

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
// Compact buttons so the table fits a normal laptop window.
const SMALL: React.CSSProperties = { padding: "4px 8px", fontSize: 12, borderRadius: 8 };
// One person's match, with its buttons under it — wraps instead of widening the table.
const MATCH: React.CSSProperties = { fontSize: 13, marginBottom: 6, overflowWrap: "anywhere" };

function EditCell({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => Promise<boolean> }) {
  const [v, setV] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      placeholder={placeholder}
      disabled={saving}
      style={{ width: "100%", minWidth: 0, boxSizing: "border-box", ...(v.trim() ? {} : MISSING) }}
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

/** Their website application has a different email/phone than AOS:
 *  show it, one click to use it (backlog #121). */
function Applied({ row, field, onUse }: {
  row: OnboardingRow; field: "email" | "phone";
  onUse: (row: OnboardingRow, field: "email" | "phone", value: string) => Promise<boolean>;
}) {
  const value = appliedDifferences(row, row.applicationContact)[field];
  if (!value) return null;
  return (
    <button type="button" title="From their website application. Click to use it instead."
      style={{ display: "block", background: "none", border: 0, padding: "2px 0 0", fontSize: 12, color: "var(--accent, #2563eb)", cursor: "pointer", textAlign: "left", overflowWrap: "anywhere" }}
      onClick={() => onUse(row, field, value)}>
      Applied with: {value}
    </button>
  );
}

export type MergePick = { row: Pick<OnboardingRow, "employeeKey" | "payrollId">; dup: DupMatch };

const FIELD_LABEL: Record<MergeField, string> = { name: "Name", email: "Email", phone: "Phone" };

/** Also used on the employee profile; onDone gets the key of the kept record. */
export function MergeDialog({ pick, onClose, onDone }: { pick: MergePick; onClose: () => void; onDone: (keptKey: string) => void }) {
  const { row, dup } = pick;
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [sides, setSides] = useState<Record<string, MergeSide> | null>(null);
  const [keep, setKeep] = useState<string>("");
  // For each field where the two records differ, whose value to use.
  const [picks, setPicks] = useState<Partial<Record<MergeField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const keys = [row.employeeKey, dup.employeeKey];
      const c: Record<string, number> = {};
      for (const k of keys) {
        const { count } = await supabase.from("timesheet_entries").select("id", { count: "exact", head: true }).eq("employee_key", k);
        c[k] = count ?? 0;
      }
      const { data, error } = await supabase.from("employees")
        .select("employee_key, full_name, first_name, last_name, email, phone").in("employee_key", keys);
      if (error) { setError(error.message); return; }
      const sd: Record<string, MergeSide> = {};
      for (const r of data ?? []) {
        sd[r.employee_key] = { employeeKey: r.employee_key, fullName: r.full_name ?? "", firstName: r.first_name ?? "",
          lastName: r.last_name ?? "", email: r.email ?? "", phone: r.phone ?? "" };
      }
      setSides(sd);
      setCounts(c);
      setKeep(defaultKeep(
        { employeeKey: row.employeeKey, payrollId: row.payrollId, entries: c[row.employeeKey] },
        { employeeKey: dup.employeeKey, payrollId: dup.payrollId, entries: c[dup.employeeKey] },
      ));
    })();
  }, [row, dup]);

  const otherKey = keep === row.employeeKey ? dup.employeeKey : row.employeeKey;
  const conflicts = sides && sides[row.employeeKey] && sides[dup.employeeKey]
    ? mergeConflicts(sides[row.employeeKey], sides[dup.employeeKey]) : [];
  // Default every choice to the kept record whenever the kept record changes.
  useEffect(() => { setPicks({}); }, [keep]);
  const chosen = (f: MergeField) => picks[f] ?? keep;
  const valueOf = (k: string, f: MergeField) => {
    const s = sides?.[k];
    if (!s) return "";
    return f === "name" ? (s.fullName || `${s.firstName} ${s.lastName}`).trim() : f === "email" ? s.email : s.phone;
  };

  const side = (key: string, payrollId: number | null) => (
    <label className="card" style={{ flex: 1, minWidth: 0, cursor: "pointer", outline: keep === key ? "2px solid var(--gold-dark)" : undefined }}>
      <input type="radio" name="keep" checked={keep === key} onChange={() => setKeep(key)} /> <b>Keep this record</b>
      <div style={{ marginTop: 8, overflowWrap: "anywhere" }}><b>{valueOf(key, "name") || key}</b></div>
      <div className="muted" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
        {payrollId != null ? `Payroll ID ${payrollId}` : "No Payroll ID"}<br />
        {valueOf(key, "email") || "no email"} · {valueOf(key, "phone") || "no phone"}<br />
        {counts ? `${counts[key]} timesheet entries` : "…"}<br />
        <small>{key}</small>
      </div>
    </label>
  );

  async function run() {
    if (!sides) return;
    setBusy(true); setError(null);
    const { error } = await mergeEmployees(otherKey, keep);
    if (error) { setBusy(false); setError(error); return; }
    const o = mergeOverrides(sides[keep], sides[otherKey], picks);
    if (Object.keys(o).length) {
      const { error: pErr } = await patchEmployeeFields(keep, o);
      if (pErr) alert(`Merged, but couldn't set the chosen ${Object.keys(o).join(", ")}: ${(pErr as any)?.message ?? pErr}. Fix it on the employee record.`);
    }
    setBusy(false);
    onDone(keep);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ width: "min(640px,95vw)" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Merge records</h3>
        <div className="action-row" style={{ gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
          {side(row.employeeKey, row.payrollId)}
          {side(dup.employeeKey, dup.payrollId)}
        </div>
        {keep && conflicts.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {conflicts.map((f) => (
              <div key={f} style={{ marginBottom: 10 }}>
                <b>{FIELD_LABEL[f]} to use</b>
                {[keep, otherKey].map((k) => (
                  <label key={k} style={{ display: "block", fontSize: 14, overflowWrap: "anywhere", cursor: "pointer" }}>
                    <input type="radio" name={`pick-${f}`} checked={chosen(f) === k}
                      onChange={() => setPicks((p) => ({ ...p, [f]: k }))} /> {valueOf(k, f)}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        {error && <div style={{ color: "#b00", marginTop: 8 }}>{error}</div>}
        <div className="action-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={run} disabled={busy || !keep || !counts || !sides}
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
  const [pxFailed, setPxFailed] = useState(false);
  // When the copy of Paychex the check used was taken.
  const [pxAt, setPxAt] = useState<string | null>(null);
  // Clear matches the check linked by itself this visit.
  const [autoLinked, setAutoLinked] = useState<{ employeeKey: string; name: string; payrollId: number }[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [merge, setMerge] = useState<MergePick | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  // Paychex is checked every time the list loads: nobody can be sent until
  // their row has been looked up (John, 2026-10-20).
  const checkPaychex = useCallback(async (keys: string[]) => {
    if (!keys.length) { setPx({}); return; }
    setPxBusy(true); setPxFailed(false);
    const r = await api("/api/onboarding/paychex", "POST", { keys });
    setPxBusy(false);
    if (!r.ok) { setPxFailed(true); setError(r.json?.error ?? `HTTP ${r.status}`); return; }
    setPx(r.json.matches);
    setPxAt(r.json.checkedAt ?? null);
    const linked: { employeeKey: string; name: string; payrollId: number }[] = r.json.linked ?? [];
    if (linked.length) {
      const gone = new Set(linked.map((x) => x.employeeKey));
      setRows((rs) => rs?.filter((x) => !gone.has(x.employeeKey)) ?? rs);
      setAutoLinked((prev) => [...prev, ...linked]);
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const r = await api("/api/onboarding");
    if (!r.ok) { setError(r.json?.error ?? `HTTP ${r.status}`); return; }
    setRows(r.json.rows);
    setPx(null);
    checkPaychex((r.json.rows as OnboardingRow[]).map((x) => x.employeeKey));
  }, [checkPaychex]);

  useEffect(() => { load(); }, [load]);

  /** Can be sent: email etc. (canSend) AND looked up in Paychex this visit. */
  const ready = (row: OnboardingRow) => canSend(row) && px?.[row.employeeKey] !== undefined;

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
    const list = (rows ?? []).filter((x) => picked.has(x.employeeKey) && ready(x));
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
      ? <div><span className="pill pill-green" title="Paychex emailed them an invite. Their Payroll ID comes once they finish setting up.">Sent {fmtDate(row.paychexInvitedAt.slice(0, 10))} · waiting</span></div>
      : null;
    const matches = px?.[row.employeeKey];
    if (!matches) {
      return (
        <>
          {sent}
          <span className="muted">{pxBusy ? "Checking…" : pxFailed ? "Couldn't check" : "—"}</span>
        </>
      );
    }
    if (!matches.length) return sent ?? <span className="muted">Not in Paychex</span>;
    return (
      <>
        {sent}
        {matches.map((m) => (
          <div key={m.workerId} style={MATCH}>
            {m.name}{m.payrollId != null ? ` #${m.payrollId}` : ""}
            <div className="muted" style={{ fontSize: 12 }}>{m.status.toLowerCase()} · {m.reason}</div>
            {m.payrollId != null && (
              <button className="secondary" style={SMALL} disabled={busyKey === row.employeeKey} onClick={() => useId(row, m)}>Use ID</button>
            )}
          </div>
        ))}
      </>
    );
  }

  if (error && !rows) return <div className="card"><div style={{ color: "#b00" }}>{error}</div></div>;
  if (!rows) return <div className="card"><div className="muted">Loading…</div></div>;

  const sendable = rows.filter(ready);
  const allPicked = sendable.length > 0 && sendable.every((x) => picked.has(x.employeeKey));
  const togglePick = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="card">
      <div className="action-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>{rows.length} without a Payroll ID</h3>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button onClick={sendSelected} disabled={batchBusy || !sendable.some((x) => picked.has(x.employeeKey))}>
            {batchBusy ? "Sending…" : `Send selected (${sendable.filter((x) => picked.has(x.employeeKey)).length})`}
          </button>
          <button className="secondary" onClick={load}>Refresh</button>
          <PaychexAsOf at={pxAt} onRefreshed={() => checkPaychex(rows.map((x) => x.employeeKey))} />
        </span>
      </div>
      {error && <div style={{ color: "#b00", marginTop: 8 }}>{error}</div>}
      {autoLinked.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13 }} title="Clear matches in Paychex — their Payroll ID was filled in automatically">
          <span className="pill pill-green">Linked from Paychex</span>{" "}
          {autoLinked.map((x) => `${x.name} #${x.payrollId}`).join(", ")}
        </div>
      )}
      <div style={{ marginTop: 12, overflowX: "auto", maxWidth: "100%" }}>
        <table style={{ tableLayout: "fixed", width: "100%", minWidth: 640 }}>
          <colgroup>
            <col style={{ width: 32 }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allPicked} disabled={!sendable.length} title="Select everyone who can be sent"
                  onChange={() => setPicked(allPicked ? new Set() : new Set(sendable.map((x) => x.employeeKey)))} />
              </th>
              <th>Person</th><th>Email / Phone</th><th>AOS duplicates</th><th>Paychex</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeKey}>
                <td>
                  <input type="checkbox" checked={picked.has(row.employeeKey)} disabled={!ready(row)}
                    onChange={() => togglePick(row.employeeKey)} />
                </td>
                <td style={{ overflowWrap: "anywhere" }}>
                  <Link href={`/employee-directory/${encodeURIComponent(row.employeeKey)}`} title="Open their profile"
                    style={{ color: "#2c4d73", textDecoration: "underline", fontWeight: 600 }}>{row.name}</Link>
                  <div className="muted" style={{ fontSize: 12, margin: "2px 0 6px" }}>
                    {row.firstWorked && (
                      <div>
                        {fmtDate(row.firstWorked.date)} · {row.firstWorked.jobName}
                        {row.lastWorked && row.lastWorked.date !== row.firstWorked.date ? ` to ${fmtDate(row.lastWorked.date)}` : ""}
                        {row.hours ? ` · ${row.hours} hrs` : ""}
                      </div>
                    )}
                    {row.nextBooked && <div>Next {fmtDate(row.nextBooked.date)} · {row.nextBooked.jobName}</div>}
                  </div>
                  <button className="secondary" style={SMALL} disabled={busyKey === row.employeeKey} onClick={() => toggleType(row)}
                    title="Click to switch Employee (W-2) / Contractor (1099)">
                    {row.employmentType === "Employee" ? "Employee" : "Contractor"}
                  </button>
                </td>
                <td>
                  <EditCell value={row.email} placeholder="email" onSave={(v) => saveField(row, "email", v)} />
                  <Applied row={row} field="email" onUse={saveField} />
                  <div style={{ height: 6 }} />
                  <EditCell value={row.phone} placeholder="phone" onSave={(v) => saveField(row, "phone", v)} />
                  <Applied row={row} field="phone" onUse={saveField} />
                </td>
                <td>
                  {row.duplicates.slice(0, 3).map((d) => (
                    <div key={d.employeeKey} style={{ ...MATCH, opacity: d.strong ? 1 : 0.75 }}>
                      {d.name}{d.payrollId != null ? ` #${d.payrollId}` : ""}
                      <div className="muted" style={{ fontSize: 12 }}>{d.reason}</div>
                      <button className="secondary" style={SMALL} onClick={() => setMerge({ row, dup: d })}>Merge</button>{" "}
                      <button className="secondary" style={SMALL} onClick={() => notSame(row, d)} title="Not the same person — stop flagging this pair">Not same</button>
                    </div>
                  ))}
                  {row.duplicates.length > 3 && <small className="muted">+{row.duplicates.length - 3} more</small>}
                </td>
                <td>{paychexCell(row)}</td>
                <td>
                  <button
                    style={{ ...SMALL, whiteSpace: "normal" }}
                    disabled={!ready(row) || busyKey === row.employeeKey || batchBusy}
                    title={row.paychexWorkerId ? "Already sent"
                      : !canSend(row) ? "Needs an email"
                      : !ready(row) ? "Waiting for the Paychex check"
                      : "Create in Paychex and email the onboarding invite"}
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
