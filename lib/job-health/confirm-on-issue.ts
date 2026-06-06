"use client";

// Issue-time gate. Called from Issue Quote / Issue Invoice buttons before
// they fire. Returns true if it's OK to proceed (no blockers, or operator
// chose Override). Returns false to abort the issue.

import { runHealthChecksByJobId } from "./runner";
import type { FindingCategory } from "./types";

export async function confirmHealthOnIssue(
  jobRequestId: string | null | undefined,
  opts: { categories?: FindingCategory[]; docLabel: string } = { docLabel: "document" },
): Promise<boolean> {
  if (!jobRequestId) return true;
  let result;
  try {
    result = await runHealthChecksByJobId(jobRequestId);
  } catch (e) {
    console.error("[job-health] confirmHealthOnIssue failed:", e);
    return true; // fail-open — don't block the issue path on our own bug
  }
  if (!result) return true;
  const relevant = opts.categories
    ? result.findings.filter((f) => opts.categories!.includes(f.category))
    : result.findings;
  const blockers = relevant.filter((f) => f.severity === "blocker");
  if (blockers.length === 0) return true;

  const lines = blockers.slice(0, 6).map((f) => `  • ${f.title}`);
  const more = blockers.length > 6 ? `\n  ...and ${blockers.length - 6} more` : "";
  const msg =
    `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} on this job that affect the ${opts.docLabel}:\n\n` +
    lines.join("\n") + more +
    `\n\nFix these first (recommended), or click OK to issue anyway.`;
  return confirm(msg);
}
