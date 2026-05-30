"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listPayrollRuns } from "@/lib/store/payroll";
import type { PayrollRun, PayrollRunStatus } from "@/lib/store/types";

function statusBadge(s: PayrollRunStatus) {
  const map: Record<PayrollRunStatus, { bg: string; fg: string; label: string }> = {
    draft:     { bg: "#fff4d6", fg: "#7a5a1a", label: "Draft" },
    finalized: { bg: "#e8f7e8", fg: "#1a5a1a", label: "Finalized" },
    exported:  { bg: "#eaf2fb", fg: "#1a4a7a", label: "Exported" },
    voided:    { bg: "#fbeaea", fg: "#8a1a1a", label: "Voided" },
  };
  const m = map[s];
  return <span className="badge" style={{ background: m.bg, color: m.fg }}>{m.label}</span>;
}

type Filter = "active" | "all" | PayrollRunStatus;

export default function PayrollList() {
  const [rows, setRows] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("active");

  async function load() {
    setLoading(true);
    setRows(await listPayrollRuns());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "active") return r.status !== "voided";
    return r.status === filter;
  });

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, justifyContent: "space-between", gap: 12 }}>
        <div>
          <small style={{ marginRight: 8 }}>Show</small>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="active">Active (excl. voided)</option>
            <option value="draft">Draft</option>
            <option value="finalized">Finalized</option>
            <option value="exported">Exported</option>
            <option value="voided">Voided</option>
            <option value="all">All</option>
          </select>
        </div>
        <Link href="/payroll/new" className="button">+ New Payroll Run</Link>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Pay Date</th>
              <th>Period</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Entries</th>
              <th style={{ textAlign: "right" }}>Employees</th>
              <th style={{ textAlign: "right" }}>Hours</th>
              <th style={{ textAlign: "right" }}>Pay</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: "16px 0" }}>Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: "16px 0" }}>No payroll runs.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/payroll/${r.id}`}>{r.payDate}</Link></td>
                <td>{r.periodStart || r.periodEnd ? `${r.periodStart ?? "…"} → ${r.periodEnd ?? "…"}` : <span className="muted">—</span>}</td>
                <td>{statusBadge(r.status)}</td>
                <td style={{ textAlign: "right" }}>{r.entryCount}</td>
                <td style={{ textAlign: "right" }}>{r.employeeCount}</td>
                <td style={{ textAlign: "right" }}>{r.totalHours.toFixed(1)}</td>
                <td style={{ textAlign: "right" }}>${r.totalPay.toFixed(2)}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.notes || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
