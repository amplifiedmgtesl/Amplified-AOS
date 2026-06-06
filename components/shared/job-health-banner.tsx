"use client";

// Page-scoped health summary strip. Drop on quote/invoice/timekeeping pages
// so Connor sees job-level issues that affect the current screen without
// having to open the Jobs tab.
//
// Categories let each page show only what matters to it — e.g. the quote
// page doesn't need to surface invoice $0-line findings.

import { useEffect, useState } from "react";
import Link from "next/link";
import { runHealthChecksByJobId } from "@/lib/job-health/runner";
import type { Finding, FindingCategory, Severity } from "@/lib/job-health/types";

type Props = {
  jobRequestId: string | null | undefined;
  /** Which finding categories matter on this page. Omit for "all". */
  categories?: FindingCategory[];
  /** Free-text noun for the message — e.g. "quote", "invoice", "timekeeping". */
  pageContext?: string;
};

const SEV_COLOR: Record<Severity, { bg: string; border: string; icon: string }> = {
  blocker: { bg: "#fef2f2", border: "#dc2626", icon: "⛔" },
  warning: { bg: "#fffbeb", border: "#d97706", icon: "⚠" },
  info:    { bg: "#eff6ff", border: "#2563eb", icon: "ℹ" },
};

export function JobHealthBanner({ jobRequestId, categories, pageContext }: Props) {
  const [findings, setFindings] = useState<Finding[] | null>(null);

  useEffect(() => {
    if (!jobRequestId) { setFindings(null); return; }
    let cancelled = false;
    runHealthChecksByJobId(jobRequestId)
      .then((res) => {
        if (cancelled || !res) return;
        const filtered = categories
          ? res.findings.filter((f) => categories.includes(f.category))
          : res.findings;
        setFindings(filtered);
      })
      .catch(() => { if (!cancelled) setFindings([]); });
    return () => { cancelled = true; };
  }, [jobRequestId, categories]);

  if (!jobRequestId || !findings || findings.length === 0) return null;

  const blockers = findings.filter((f) => f.severity === "blocker").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const worst: Severity = blockers > 0 ? "blocker" : warnings > 0 ? "warning" : "info";
  const s = SEV_COLOR[worst];

  const ctx = pageContext ? ` that affect this ${pageContext}` : "";
  const parts: string[] = [];
  if (blockers > 0) parts.push(`${blockers} blocker${blockers === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  const remaining = findings.length - blockers - warnings;
  if (remaining > 0) parts.push(`${remaining} info`);

  return (
    <div style={{
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 4,
      padding: "8px 12px",
      fontSize: 13,
      marginBottom: 12,
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}>
      <strong>{s.icon} Health Check:</strong>
      <span>{parts.join(" · ")}{ctx}.</span>
      <Link
        href={`/job-requests?id=${encodeURIComponent(jobRequestId)}&tab=health`}
        style={{ marginLeft: "auto", fontWeight: 500 }}
      >
        Review on Job →
      </Link>
    </div>
  );
}
