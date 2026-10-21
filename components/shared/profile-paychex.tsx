"use client";

// Paychex section of an employee's profile (2026-10-20). Admins only: the
// parent doesn't render it for anyone else, so no Paychex call is ever made
// for a crew lead or coordinator.
//
// No Payroll ID: Paychex is checked on open (same rules as the Onboarding
// page; a clear match is linked automatically), possible duplicates and
// Paychex matches are listed, and Add to Paychex stays greyed out until
// there's nothing left to sort out.
// Has a Payroll ID: Sync from Paychex for this one person (same rules as the
// Payroll page's sync). Possible duplicates are listed either way.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { canSend, type DupMatch, type PaychexMatch } from "@/lib/onboarding/plan";
import type { SendOutcome } from "@/lib/onboarding/send";
import type { FieldChange, SyncChange, SyncReport } from "@/lib/paychex/sync-plan";
import type { EmployeeRecord } from "@/lib/store/types";
import { MergeDialog, type MergePick } from "@/components/shared/onboarding";
import PaychexAsOf, { fmtWhen } from "@/components/shared/paychex-as-of";

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

const SMALL: React.CSSProperties = { padding: "4px 8px", fontSize: 12, borderRadius: 8 };
const ITEM: React.CSSProperties = { fontSize: 13, marginBottom: 8, overflowWrap: "anywhere" };

const FIELD: Record<FieldChange["field"], string> = {
  status: "Status", payrollName: "Payroll name", phone: "Phone", email: "Email",
  address: "Address", city: "City", stateCode: "State", zip: "Zip",
};

type Data = {
  mode: "onboard" | "sync";
  duplicates: DupMatch[];
  matches?: PaychexMatch[];
  linked?: { payrollId: number; paychexName: string } | null;
  sentAt?: string | null;
  /** When the copy of Paychex was taken (null = never). */
  snapshotAt?: string | null;
  inPaychex?: boolean;
  changes?: SyncChange[];
  reports?: SyncReport[];
};

function describe(c: SyncChange): string {
  if (c.kind === "update" || c.kind === "link") {
    return c.fields.map((f) => `${FIELD[f.field]}: ${f.from || "blank"} → ${f.to}`).join("; ");
  }
  if (c.kind === "reid") return `Payroll ID ${c.fromPayrollId} → ${c.payrollId} (${c.paychexName}, ${c.paychexStatus.toLowerCase()} in Paychex)`;
  if (c.kind === "clear") return `Payroll ID ${c.payrollId} isn't in Paychex: clear it`;
  return "";
}

export default function ProfilePaychex({ employee }: { employee: EmployeeRecord }) {
  const key = employee.employeeKey;
  const payrollId = employee.ripplingEmployeeId ?? null;
  const [data, setData] = useState<Data | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState<MergePick | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const load = useCallback(async (sync = false) => {
    setChecking(true); setError(null);
    const r = await api(`/api/employee-paychex?key=${encodeURIComponent(key)}${sync ? "&sync=1" : ""}`);
    setChecking(false);
    if (!r.ok) { setError(r.json?.error ?? `HTTP ${r.status}`); return; }
    setData(r.json);
    if (r.json.changes) setTicked(new Set((r.json.changes as SyncChange[]).map((c) => c.id)));
    // Linked automatically: reload so the profile shows the new Payroll ID.
    if (r.json.linked) setTimeout(() => window.location.reload(), 1500);
  }, [key]);

  // Without a Payroll ID this checks Paychex; with one it only reads AOS
  // (duplicates). The Paychex sync waits for the button.
  useEffect(() => { void load(false); }, [load, payrollId]);

  async function notSame(d: DupMatch) {
    const r = await api("/api/onboarding/not-same", "POST", { a: key, b: d.employeeKey });
    if (!r.ok) { alert(r.json?.error ?? "Couldn't save"); return; }
    setData((x) => x && { ...x, duplicates: x.duplicates.filter((y) => y.employeeKey !== d.employeeKey) });
  }

  async function useId(m: PaychexMatch) {
    if (!confirm(`Give ${employee.fullName} Payroll ID ${m.payrollId} (${m.name} in Paychex)?`)) return;
    setBusy(true);
    const r = await api("/api/onboarding/use-id", "POST", { employeeKey: key, workerId: m.workerId });
    setBusy(false);
    if (!r.ok) { alert(r.json?.error ?? "Couldn't link"); return; }
    window.location.reload();
  }

  async function postSend(ignoreMatches: boolean): Promise<SendOutcome | null> {
    const r = await api("/api/onboarding/send", "POST", { employeeKeys: [key], ignoreMatches });
    if (!r.ok) { alert(r.json?.error ?? "Send failed"); return null; }
    return (r.json.results as SendOutcome[])[0] ?? null;
  }

  async function addToPaychex() {
    const type = employee.employmentType === "Employee" ? "Employee (W-2)" : "Contractor (1099)";
    if (!confirm(`Add to Paychex?\n\n${employee.fullName}\n${employee.email}\n${type}\n\nPaychex will email them an onboarding invite.`)) return;
    setBusy(true);
    let out = await postSend(false);
    if (out?.kind === "needsConfirm") {
      const list = out.matches.map((m) => `• ${m.name}${m.payrollId != null ? ` #${m.payrollId}` : ""} (${m.status.toLowerCase()}) — ${m.reason}`).join("\n");
      out = confirm(`Paychex may already have this person:\n\n${list}\n\nAdd a new worker anyway?`) ? await postSend(true) : null;
    }
    setBusy(false);
    if (!out) return;
    if (out.kind === "dryRun") alert("Preview only — nothing was sent to Paychex. Sending works on the live site.");
    else if (out.kind === "error") alert(`Failed: ${out.error}`);
    else if (out.kind === "sent") {
      if (!out.emailOnFile) alert("Sent, but Paychex shows no email on them, so the invite may not have gone out. Check them in Flex.");
      window.location.reload();
    }
  }

  async function applySync() {
    if (!ticked.size) return;
    setBusy(true);
    const r = await api("/api/employee-paychex", "POST", { key, ids: [...ticked] });
    setBusy(false);
    if (!r.ok) { alert(r.json?.error ?? "Couldn't apply"); return; }
    if (r.json.failed?.length) alert(`Some changes failed:\n${r.json.failed.map((f: { error?: string }) => f.error).join("\n")}`);
    window.location.reload();
  }

  const dups = data?.duplicates ?? [];
  const matches = data?.matches ?? [];
  const sent = !!data?.sentAt;

  // Why Add to Paychex is greyed out, or "" when it can be sent.
  const blocked = payrollId != null ? "Already has a Payroll ID"
    : checking || !data ? "Checking Paychex…"
    : error ? "Couldn't check Paychex"
    : !data.snapshotAt ? "No copy of Paychex yet: click Update from Paychex"
    : sent ? "Already sent"
    : !canSend({ email: employee.email ?? "", payrollId, paychexWorkerId: null }) ? "Needs an email"
    : dups.length ? "Merge or mark Not same on the possible duplicates first"
    : matches.length ? "Paychex may already have them: use Use ID, or check in Paychex"
    : "";

  return (
    <div style={{ marginTop: 16 }}>
      <div className="action-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        <h3 className="section-title" style={{ margin: 0 }}>Paychex</h3>
        {(payrollId == null || data?.changes) && <PaychexAsOf at={data?.snapshotAt} onRefreshed={() => load(payrollId != null)} />}
      </div>
      {error && <div style={{ color: "#b00", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {data?.linked && (
        <div style={ITEM}><span className="pill pill-green">Linked from Paychex</span> Payroll ID {data.linked.payrollId} ({data.linked.paychexName})</div>
      )}

      {dups.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <b style={{ fontSize: 13 }}>Possible duplicates in AOS</b>
          {dups.map((d) => (
            <div key={d.employeeKey} style={{ ...ITEM, opacity: d.strong ? 1 : 0.75 }}>
              <a href={`/employee-directory/${encodeURIComponent(d.employeeKey)}`}>{d.name}</a>{d.payrollId != null ? ` #${d.payrollId}` : ""}
              <span className="muted"> · {d.reason}</span>{" "}
              <button className="secondary" style={SMALL} onClick={() => setMerge({ row: { employeeKey: key, payrollId }, dup: d })}>Merge</button>{" "}
              <button className="secondary" style={SMALL} onClick={() => notSame(d)} title="Not the same person — stop flagging this pair">Not same</button>
            </div>
          ))}
        </div>
      )}

      {payrollId == null ? (
        <>
          {matches.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <b style={{ fontSize: 13 }}>Possible matches in Paychex</b>
              {matches.map((m) => (
                <div key={m.workerId} style={ITEM}>
                  {m.name}{m.payrollId != null ? ` #${m.payrollId}` : ""}
                  <span className="muted"> · {m.status.toLowerCase()} · {m.reason}</span>{" "}
                  {m.payrollId != null && <button className="secondary" style={SMALL} disabled={busy} onClick={() => useId(m)}>Use ID</button>}
                </div>
              ))}
            </div>
          )}
          {sent && (
            <div style={ITEM}>
              <span className="pill pill-green" title="Paychex emailed them an invite. Their Payroll ID comes once they finish setting up.">
                Sent to Paychex {fmtWhen(String(data?.sentAt))} · waiting for them
              </span>
            </div>
          )}
          {data?.snapshotAt && !matches.length && !sent && !error && <div className="muted" style={ITEM}>Not in Paychex</div>}
          <button disabled={!!blocked || busy} title={blocked || "Create in Paychex and email them the onboarding invite"} onClick={addToPaychex}>
            {busy ? "…" : checking ? "Checking Paychex…" : "Add to Paychex"}
          </button>
        </>
      ) : (
        <>
          {data?.changes ? (
            <div style={{ marginBottom: 10 }}>
              {data.inPaychex === false && <div style={ITEM}>Payroll ID {payrollId} isn't an active worker in Paychex.</div>}
              {data.changes.length === 0 && data.inPaychex !== false && <div className="muted" style={ITEM}>Matches Paychex.</div>}
              {data.changes.map((c) => (
                <label key={c.id} style={{ ...ITEM, display: "block", cursor: "pointer" }}>
                  <input type="checkbox" checked={ticked.has(c.id)}
                    onChange={() => setTicked((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />{" "}
                  {describe(c)}
                </label>
              ))}
              {(data.reports ?? []).map((r, i) => <div key={i} className="muted" style={ITEM}>{r.message}</div>)}
              {data.changes.length > 0 && (
                <button disabled={busy || !ticked.size} onClick={applySync}>{busy ? "Applying…" : `Apply (${ticked.size})`}</button>
              )}
            </div>
          ) : (
            <button className="secondary" disabled={checking} onClick={() => load(true)}
              title="Show what Paychex has that differs from AOS for this person. Nothing changes until you click Apply.">
              {checking ? "Reading Paychex…" : "🔄 Sync from Paychex"}
            </button>
          )}
        </>
      )}

      {merge && (
        <MergeDialog pick={merge} onClose={() => setMerge(null)}
          onDone={(kept) => {
            setMerge(null);
            if (kept === key) window.location.reload();
            else window.location.href = `/employee-directory/${encodeURIComponent(kept)}`;
          }} />
      )}
    </div>
  );
}
