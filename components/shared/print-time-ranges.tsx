"use client";

// Renders time blocks for the job print documents: one block per line (#74),
// `*` on individual times (#75), `(+1)` on next-day times (#77). The rules live
// in lib/jobs/print-format.ts; this only lays them out.

import type { PrintRange } from "@/lib/jobs/print-format";
import { printRangeText } from "@/lib/jobs/print-format";

export function PrintTimeRanges({ ranges, empty = "" }: { ranges: PrintRange[]; empty?: React.ReactNode }) {
  if (ranges.length === 0) return <>{empty}</>;
  return (
    <>
      {ranges.map((r, i) => (
        <div key={i} className="print-range">{printRangeText(r)}</div>
      ))}
    </>
  );
}

/** One-line key shown under a table when any time on it is starred. */
export function OverrideKey() {
  return <div className="print-override-key">* individual time — differs from the day&apos;s schedule</div>;
}
