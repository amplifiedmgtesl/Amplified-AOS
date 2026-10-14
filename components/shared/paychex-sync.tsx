"use client";

// "Sync from Paychex" (backlog #117). Admin-only panel on the Payroll page:
// reads active Paychex workers through /api/paychex/sync, shows what would
// change, and applies only the ticked rows. Names, W-2/1099 differences and
// anything ambiguous are listed for a person to handle — never changed here.

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { SyncChange, SyncReport, FieldChange } from "@/lib/paychex/sync-plan";

type Preview = { changes: SyncChange[]; reports: SyncReport[]; activeWorkers: number; fetchedAt: string };
type ApplyResult = { applied: number; failed: { id: string; error: string }[]; skipped: number };

const LABEL: Record<FieldChange["field"], string> = {
  status: "Status", payrollName: "Payroll name", phone: "Phone", email: "Email", address: "Address", city: "City", stateCode: "State", zip: "Zip",
};

async function call(method: "GET" | "POST", body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/paychex/sync", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

function Fields({ fields }: { fields: FieldChange[] }) {
  if (!fields.length) return <small style={{ color: "#888" }}>—</small>;
  return (
    <>
      {fields.map((f) => (
        <div key={f.field} style={{ fontSize: 13 }}>
          <b>{LABEL[f.field]}:</b>{" "}
          <span style={{ color: "#999", textDecoration: f.from ? "line-through" : undefined }}>{f.from || "blank"}</span>
          {" → "}{f.to}
        </div>
      ))}
    </>
  );
}

export default function PaychexSync() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "load" | "apply">(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function load() {
    setOpen(true); setBusy("load"); setError(null); setResult(null);
    try {
      const p: Preview = await call("GET");
      setPreview(p);
      setPicked(new Set(p.changes.map((c) => c.id)));
    } catch (e: any) {
      setError(e?.message ?? "Sync failed");
    } finally { setBusy(null); }
  }

  async function apply() {
    if (!picked.size) return;
    setBusy("apply"); setError(null);
    try {
      const r: ApplyResult = await call("POST", { ids: [...picked] });
      setResult(r);
      setPreview(null);
    } catch (e: any) {
      setError(e?.message ?? "Apply failed");
    } finally { setBusy(null); }
  }

  const groups = useMemo(() => {
    const c = preview?.changes ?? [];
    return {
      update: c.filter((x) => x.kind === "update"),
      link: c.filter((x) => x.kind === "link"),
      create: c.filter((x) => x.kind === "create"),
      ids: c.filter((x) => x.kind === "reid" || x.kind === "clear"),
    };
  }, [preview]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setAll = (list: SyncChange[], on: boolean) => setPicked((s) => {
    const n = new Set(s); for (const c of list) on ? n.add(c.id) : n.delete(c.id); return n;
  });

  const section = (title: string, list: SyncChange[], cols: string[], row: (c: SyncChange) => React.ReactNode[]) =>
    list.length === 0 ? null : (
      <div style={{ marginTop: 16 }}>
        <div className="action-row" style={{ justifyContent: "space-between" }}>
          <h4 style={{ margin: 0 }}>{title} ({list.length})</h4>
          <span>
            <button className="secondary" onClick={() => setAll(list, true)}>All</button>{" "}
            <button className="secondary" onClick={() => setAll(list, false)}>None</button>
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th style={{ width: 32 }} />{cols.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  {row(c).map((cell, i) => <td key={i}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

  if (!open) {
    return (
      <button className="secondary" onClick={load} title="Read active workers from Paychex and preview updates to AOS employee records">
        🔄 Sync from Paychex
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12, flexBasis: "100%" }}>
      <div className="action-row" style={{ justifyContent: "space-between" }}>
        <h3 className="section-title" style={{ margin: 0 }}>Sync from Paychex</h3>
        <span>
          <button className="secondary" onClick={load} disabled={!!busy}>Refresh</button>{" "}
          <button className="secondary" onClick={() => setOpen(false)} disabled={busy === "apply"}>Close</button>
        </span>
      </div>

      {busy === "load" && <p>Reading Paychex…</p>}
      {error && <p style={{ color: "#a00" }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 12 }}>
          <p>Applied {result.applied}{result.failed.length ? `, ${result.failed.length} failed` : ""}{result.skipped ? `, ${result.skipped} no longer needed` : ""}.</p>
          {result.failed.map((f) => <div key={f.id} style={{ color: "#a00", fontSize: 13 }}>{f.id}: {f.error}</div>)}
        </div>
      )}

      {preview && !busy && (
        <>
          <p style={{ margin: "8px 0 0" }}>
            <small>{preview.activeWorkers} active in Paychex · {preview.changes.length} change{preview.changes.length === 1 ? "" : "s"} · {preview.reports.length} to check by hand</small>
          </p>

          {section("Updates from Paychex", groups.update, ["Employee", "Payroll ID", "Changes"], (c) => {
            const u = c as Extract<SyncChange, { kind: "update" }>;
            return [u.name, `#${u.payrollId}`, <Fields key="f" fields={u.fields} />];
          })}

          {section("New Payroll IDs", groups.link, ["AOS employee", "Paychex name", "Payroll ID", "Matched on", "Changes"], (c) => {
            const l = c as Extract<SyncChange, { kind: "link" }>;
            return [l.name, l.paychexName, `#${l.payrollId}`, l.matchedOn, <Fields key="f" fields={l.fields} />];
          })}

          {section("Payroll IDs not in Paychex", groups.ids, ["Employee", "AOS Payroll ID", "Change to"], (c) => {
            if (c.kind === "reid") return [c.name, `#${c.fromPayrollId}`, `#${c.payrollId} (${c.paychexName}${c.paychexStatus !== "ACTIVE" ? ", inactive" : ""})`];
            const x = c as Extract<SyncChange, { kind: "clear" }>;
            return [x.name, `#${x.payrollId}`, "blank"];
          })}

          {section("New people", groups.create, ["Name", "Payroll ID", "Type", "Contact"], (c) => {
            const n = c as Extract<SyncChange, { kind: "create" }>;
            const ct = n.contact;
            return [n.name, `#${n.payrollId}`, n.employmentType === "Employee" ? "W-2" : "1099",
              <small key="c">{[ct.phone, ct.email, [ct.city, ct.stateCode].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "—"}</small>];
          })}

          {preview.reports.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: 0 }}>To check by hand ({preview.reports.length})</h4>
              <ul style={{ marginTop: 6 }}>
                {preview.reports.map((r, i) => <li key={i} style={{ fontSize: 13 }}>{r.message}</li>)}
              </ul>
            </div>
          )}

          {preview.changes.length > 0 && (
            <div className="action-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={apply} disabled={!picked.size}>Apply {picked.size} change{picked.size === 1 ? "" : "s"}</button>
            </div>
          )}
          {preview.changes.length === 0 && <p>AOS already matches Paychex.</p>}
        </>
      )}
      {busy === "apply" && <p>Applying…</p>}
    </div>
  );
}
