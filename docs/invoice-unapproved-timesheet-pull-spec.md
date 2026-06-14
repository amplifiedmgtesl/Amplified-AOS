# Invoice: Pull Unapproved Timesheets + Drift Highlighting — Spec

**Status:** Draft for discussion with Connor. Revised 2026-06-02 against the real `overwriteFromTimesheets` model.
**Related files:** [lib/store/invoices.ts](../lib/store/invoices.ts) (`overwriteFromTimesheets`, `getAlreadyBilledTimesheetEntryIds`), [components/shared/invoice-builder.tsx](../components/shared/invoice-builder.tsx), DB trigger `invoices_release_entries_trg` (migration 20260527b).

---

## Problem

Connor often needs to invoice clients before timesheets are approved — sometimes before they're filled out. Today the "Overwrite from Timesheets" flow (`overwriteFromTimesheets` in invoices.ts) only pulls entries where `status='approved'` ([invoices.ts:553](../lib/store/invoices.ts)). He ends up retyping the same labor data manually from the timekeeping screen. Goal: let him pull unapproved data to save time, **without** breaking the audit trail or risking double-billing.

---

## How the link actually works today

This is **much stronger** than a simple snapshot. The system has end-to-end traceability between billed lines and source timesheet entries:

- `overwriteFromTimesheets()` reads approved entries for the job, groups them by (work_date, shift_id, position), and creates real **`invoice_lines` rows** with `source_kind='timesheet_entry'`.
- Each invoice line **back-links** to its source entries via `timesheet_entries.invoice_line_id` ([invoices.ts:784-795](../lib/store/invoices.ts)).
- Three line `source_kind` values exist: `quote_line`, `timesheet_entry`, `manual_override`. On re-pull, only `quote_line` + `timesheet_entry` lines are wiped and rebuilt — `manual_override` lines are preserved ([invoices.ts:596-599](../lib/store/invoices.ts)).
- **Double-billing prevention is structural:** `getAlreadyBilledTimesheetEntryIds()` filters by `invoice_line_id IS NOT NULL` ([invoices.ts:252-260](../lib/store/invoices.ts)). Entries linked to active invoice lines are excluded from any subsequent pull on any invoice.
- **Void/revise releases entries automatically:** DB trigger `invoices_release_entries_trg` (migration 20260527b) clears `timesheet_entries.invoice_line_id` the moment its parent invoice transitions to `superseded` or `void`. A non-null pointer always implies an ACTIVE invoice line.
- **Freeze protection on the timekeeping side:** entries bound to an active invoice line can't have their status changed (per code comment at [invoices.ts:506](../lib/store/invoices.ts)). Editing path is: void/revise the invoice → entries auto-release → edit on timekeeping → re-pull.
- Final-only: the overwrite path refuses to run on deposit invoices ([invoices.ts:536](../lib/store/invoices.ts)).

This shape is excellent for what we want to build. Drift detection works **per invoice line** (compare back-linked entries' current state vs the line) rather than as an aggregate snapshot diff.

---

## Proposed changes

### 1. Allow pulling unapproved entries

- Drop the `.eq("status", "approved")` filter in `overwriteFromTimesheets` ([invoices.ts:553](../lib/store/invoices.ts)) — or make it configurable via an `includePending?: boolean` option that defaults to true going forward (and we update the caller to pass it).
- Capture per-line metadata on what was pulled. On each `timesheet_entry` line, store the count of approved vs pending entries at pull time so the invoice line itself remembers its sourcing posture:
  - New columns on `invoice_lines` (or a small jsonb metadata field) — `pulled_approved_count`, `pulled_pending_count`, `pulled_at` timestamp.
- UI status badge near the line table: *"Pulled from 12 approved + 4 pending entries on 2026-06-02. 4 entries may still change."*
- Already-billed dedupe (`invoice_line_id IS NOT NULL`) still works correctly with pending entries — no change there. Pending entries get bound and frozen on the timekeeping side the same way approved ones do, by virtue of the existing freeze trigger.

**Open question for Connor:** when pending entries get approved later, do we want the invoice line to auto-reflect any value change, or only on explicit re-pull? Recommend: never auto-update. Drift surfaces the change; Connor decides.

### 2. Drift detection on view

The back-pointer model makes this clean. For each invoice line with `source_kind='timesheet_entry'`:

1. Load its back-linked entries: `SELECT * FROM timesheet_entries WHERE invoice_line_id = <line_id>`.
2. Re-aggregate (std_hours, ot_hours, dt_hours, crew count) from those entries' current values.
3. Compare to the line's stored values.
4. Also check: are there `timesheet_entries` for this job (matching the same (date, shift, position) grouping) that have `invoice_line_id IS NULL` and weren't already-billed elsewhere? Those are **new entries** that would land on the invoice if Connor re-pulled now.

Drift categories:

| Case | Visual treatment |
|---|---|
| Line's back-linked entries match stored line values | No highlight |
| Back-linked entries' values changed (hours edited post-pull) | Yellow tint on changed cells, tooltip with current value + delta |
| Some back-linked entries deleted (the trigger NULLed their pointers, but the line still bills them) | Row marked "source entries removed — N of M still linked" |
| New entries exist for this job that aren't on any line yet | Ghost row at bottom of the line table, muted, "N unbilled entries on YYYY-MM-DD — re-pull to include" |
| Pending → approved (no value change) | **Not** drift. Don't highlight. |
| Pending → approved + value change | Yellow as normal drift |

All drift detection runs in the builder + invoice detail view. **Not** on the PDF — customer sees what was billed, clean.

### 3. Context-aware re-pull button

Today's "Overwrite from Timesheets" button stays in place but adapts:

- No `timesheet_entry` lines yet → "Pull Labor Actuals from Timesheets" (current label fine)
- Lines exist, no drift → button shows "Re-pull (no changes detected)", muted/disabled
- Lines exist, drift detected → "Re-pull Labor Actuals — N lines have changes", prominent
- Invoice frozen (`isDraft=false`) → button hidden. Drift remains **visible read-only** in the table with the existing finalized-state badge.

### 4. PDF / customer-facing view

- PDF renders lines clean — no drift highlights, no badges. The customer sees what was billed.
- In-app invoice detail view (the non-builder, read-only view) shows the same drift highlights as the builder, since it helps Connor spot reconciliation issues when scrolling the invoice list.

### 5. Finalize failsafe

Drafts already print with a `DRAFT` watermark + `(DRAFT)` filename suffix ([invoice-pdf-view.tsx:212](../components/shared/invoice-pdf-view.tsx)), so draft prints are inherently safe. The real risk is **finalizing** while drift exists, then printing clean.

- When drift is detected and Connor clicks **Finalize**, show a confirmation dialog:
  > **Heads up — timekeeping has changed since this invoice was pulled.**
  > N lines show differences vs. the live timesheet data.
  > [ Re-pull and review ] [ Finalize anyway ]
- Default focus on "Re-pull and review" — "Finalize anyway" is always allowed (failsafe, not a block).
- No dialog on print itself — DRAFT watermark covers the unfinalized case. Once finalized, lines are frozen and drift becomes read-only audit info on the in-app detail view.
- No dialog when there's no drift — finalize stays one-click in the normal case.

---

## Void / revise interaction (answers to user questions)

These work correctly today and remain correct under the proposed changes:

**Can we re-pull after voiding or revising an invoice?** Yes. The `invoices_release_entries_trg` trigger clears `timesheet_entries.invoice_line_id` on void/superseded transition. Released entries become re-pullable onto a new draft (or the revision's draft) immediately. No orphaned data, no manual cleanup.

**Are we safe from double-billing?** Yes, structurally. The `invoice_line_id IS NOT NULL` filter in `getAlreadyBilledTimesheetEntryIds` ensures entries currently bound to an ACTIVE invoice line are excluded from every other pull. Because the release trigger keeps that pointer accurate (only active invoices "own" entries), the dedupe is reliable. One invoice line per entry, enforced at the DB level.

This is true today for approved entries; **extending the pull to unapproved entries inherits the same protection unchanged** — the binding/back-pointer machinery doesn't care about approval state.

---

## Edge cases & risks

1. **Entry deleted entirely post-pull** — trigger NULLs the back-pointer on deletion (or the entry is gone). The invoice line still bills the value. Drift category: "source entries removed". Connor decides whether to re-pull (which would lower the line) or leave (e.g., he already invoiced the higher number — would need a credit memo).
2. **Approval flip with no value change** — explicitly not drift; suppress highlighting.
3. **Manual-override line edited to match nothing** — manual lines have `source_kind='manual_override'`, no back-pointer, no drift analysis. They stay as-is on re-pull. Already correct.
4. **Holiday/OT recalc on unapproved entries** — drafts auto-recalc per [project_holiday_handling.md](../memory/project_holiday_handling.md). Surfaces as drift on the back-linked entries. Re-pull resolves it.
5. **Multiple invoices for one job (progress billing)** — the dedupe model already supports this: each entry can only be on one active invoice line. If Connor wants progress billing he can use `coveredDates` filter ([invoices.ts:574](../lib/store/invoices.ts)) to pull only specific dates onto each invoice. Confirm with Connor he actually does this — affects whether we need a "billed dates" tracker UI.
6. **Deposit invoices** — overwrite path is final-only ([invoices.ts:536](../lib/store/invoices.ts)). No change needed; deposits don't carry timesheet lines.

---

## Out of scope (for this spec)

- Schema migrations to add new entry-level statuses (e.g. "invoice-locked"). The existing freeze trigger covers the lock semantics.
- Auto-recompute of finalized invoices on later approval flips. Always manual re-pull (and revise if finalized).
- Approval workflow changes in timekeeping itself.
- Credit memo workflow for over-bills discovered post-finalize. Tracked separately in [project_todo.md](../../../Users/johnobrien/.claude/projects/C--amplified-Amplified-AOS/memory/project_todo.md) under "Invoice corrections after send".

---

## Implementation sketch

- **~0.5 day** — drop the `status='approved'` filter (or make it configurable), add `pulled_approved_count`/`pulled_pending_count`/`pulled_at` to each `timesheet_entry`-sourced line (small jsonb metadata field is fine — no schema migration risk if jsonb; or 3 columns if we want them queryable).
- **~1 day** — drift detection util: load back-linked entries per line, re-aggregate, compute deltas, return a structured drift report. Pure read-side, no writes.
- **~1 day** — drift rendering in the builder line table (yellow tint, tooltips, ghost rows for unbilled entries, removed-source banner).
- **~0.5 day** — drift in invoice detail view (read-only path, reuse the same util + components).
- **~0.5 day** — finalize confirmation dialog + status badge wiring + verify PDF stays clean.

**Total: ~3.5 days.** No DB migration needed if we use a jsonb metadata field for the pull-time counts; if we want queryable columns, add a tiny additive migration (~30 min).

---

## Questions for Connor

1. How often does he invoice before timesheets are approved? (validates priority)
2. Does he ever bill **multiple invoices** against one job's timesheet data (progress billing across event days)? Affects how prominent the `coveredDates` controls need to be.
3. When drift is found AFTER an invoice is finalized/sent, what's his workflow today — re-issue / annotate / credit memo? (Out of spec scope, but answer shapes whether we need a "drift acknowledged" marker.)
4. Should the **invoice list view** show a drift badge so he can spot affected invoices without opening each one?
5. When pending entries get approved later with no value change, should we surface that anywhere, or treat it as a silent no-op? Recommend silent.
