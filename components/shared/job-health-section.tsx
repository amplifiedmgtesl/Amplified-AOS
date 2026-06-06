"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { JobRequest } from "@/lib/store/types";
import { runHealthChecks } from "@/lib/job-health/runner";
import type { Finding, Severity } from "@/lib/job-health/types";

type Props = { jobRequest: JobRequest; refreshKey?: number };

const SEV_STYLE: Record<Severity, { label: string; bg: string; border: string; icon: string }> = {
  blocker: { label: "Blocker", bg: "#fef2f2", border: "#dc2626", icon: "⛔" },
  warning: { label: "Warning", bg: "#fffbeb", border: "#d97706", icon: "⚠" },
  info:    { label: "Info",    bg: "#eff6ff", border: "#2563eb", icon: "ℹ" },
};

const SEV_ORDER: Severity[] = ["blocker", "warning", "info"];

export function JobHealthSection({ jobRequest, refreshKey = 0 }: Props) {
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runHealthChecks(jobRequest)
      .then(({ findings }) => { if (!cancelled) setFindings(findings); })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobRequest, refreshKey]);

  if (loading) {
    return <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>Running health checks…</div>;
  }
  if (error) {
    return <div style={{ fontSize: 13, padding: 8, color: "#dc2626" }}>Health check failed: {error}</div>;
  }
  if (findings.length === 0) {
    return (
      <div style={{
        background: "#ecfdf5",
        border: "1px solid #10b981",
        borderRadius: 4,
        padding: 12,
        fontSize: 13,
      }}>
        <strong>✓ No issues detected.</strong>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Rate card, job setup, quote/invoice consistency, and timesheet hygiene all look clean.
        </div>
      </div>
    );
  }

  const byKey: Record<Severity, Finding[]> = { blocker: [], warning: [], info: [] };
  for (const f of findings) byKey[f.severity].push(f);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {findings.length} issue{findings.length === 1 ? "" : "s"} detected · {byKey.blocker.length} blocker · {byKey.warning.length} warning · {byKey.info.length} info
      </div>
      {SEV_ORDER.map((sev) => {
        const items = byKey[sev];
        if (items.length === 0) return null;
        const s = SEV_STYLE[sev];
        return (
          <div key={sev} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{s.label} ({items.length})</div>
            {items.map((f) => (
              <div key={f.id} style={{
                background: s.bg,
                border: `1px solid ${s.border}`,
                borderRadius: 4,
                padding: 10,
                fontSize: 13,
              }}>
                <div style={{ fontWeight: 600 }}>{s.icon} {f.title}</div>
                <div style={{ marginTop: 4 }}>{f.detail}</div>
                <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                  <strong>Downstream:</strong> {f.downstream}
                </div>
                {f.fixHref ? (
                  <div style={{ marginTop: 6 }}>
                    <Link href={f.fixHref} style={{ fontSize: 12, fontWeight: 500 }}>
                      → {f.fixLabel ?? "Fix"}
                    </Link>
                  </div>
                ) : f.fixLabel ? (
                  <div className="muted" style={{ marginTop: 6, fontSize: 12, fontStyle: "italic" }}>
                    {f.fixLabel}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Lightweight finding count for the tab badge. Returns null while loading. */
export function useJobHealthCount(jobRequest: JobRequest | null, refreshKey = 0): {
  blocker: number;
  warning: number;
  total: number;
} | null {
  const [counts, setCounts] = useState<{ blocker: number; warning: number; total: number } | null>(null);
  useEffect(() => {
    if (!jobRequest?.id) { setCounts(null); return; }
    let cancelled = false;
    runHealthChecks(jobRequest)
      .then(({ findings }) => {
        if (cancelled) return;
        const blocker = findings.filter((f) => f.severity === "blocker").length;
        const warning = findings.filter((f) => f.severity === "warning").length;
        setCounts({ blocker, warning, total: findings.length });
      })
      .catch(() => { if (!cancelled) setCounts({ blocker: 0, warning: 0, total: 0 }); });
    return () => { cancelled = true; };
  }, [jobRequest, refreshKey]);
  return counts;
}
