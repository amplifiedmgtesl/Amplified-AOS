# Data-integrity audit + fix scripts

Origin: V2 pre-cutover work, 2026-05-28. Connor flagged that the
holiday-toggle path could leave stored line totals out of sync with
the formula. Audit confirmed drift on dev (none for quote_lines /
quote totals / invoice lines / invoice subtotals; drift on
`invoices.amount_due` and 4 legacy `Mark Paid` invoices with zero
`paid_amount`). Corrective SQL ran on dev 2026-05-28 — audit re-ran
clean afterward.

## Files

- **`01_audit_drafts.sql`** — read-only. 7 sections. Counts drift in
  every stored-aggregate column on draft quotes + invoices, and finds
  legacy paid invoices needing payment-row backfill.
- **`02_fix_drafts.sql`** — corrective. 7 sections wrapped in
  `BEGIN/COMMIT`. Idempotent (re-run = no-op). Drafts only — frozen
  rows are historical record and untouched.
- **`03_audit_frozen.sql`** — read-only. Same shape as #1 but scoped
  to frozen documents. Output is per-row for human review (Connor
  decides per-document whether to revise or leave alone).
- **`04_audit_deposits.sql`** — read-only. Three deposit-specific
  checks: stray lines on deposits (current design = zero), subtotal
  vs quote × deposit_pct mismatch, and stale `deposit_applied` on
  finals.
- **`05_fix_deposit_stray_lines.sql`** — corrective. Targets only the
  safe sub-set from `04` Check 1: deposits where `lines_sum ==
  subtotal` (deleting the stray lines doesn't change any displayed
  value). Bypasses the invoice_lines freeze trigger inside the
  transaction. Idempotent.
- **`06_audit_duplicate_jobs.sql`** — read-only. Section A lists every
  FK + legacy-text reference count for the four known duplicate
  job_request clusters (KY Event, Revival Night, Bruno Mars, Carolina).
  Section B sweeps for free-text orphans naming the same client +
  date window without an id pointer. Run AFTER Phase 2 migrations
  apply.
- **`07_merge_ky_event.sql`** — corrective. Deletes 2 empty KY Event
  siblings (memory #2). Pre-flight asserts zero external refs. Cascade
  deletes child rows. Idempotent.
- **`08_merge_revival_night.sql`** — corrective. Deletes 1 empty
  Revival Night sibling (memory #2). Same shape as #07.
- **`09_retire_bruno_mars.sql`** — corrective. Soft-retires (status =
  'cancelled') the abandoned Bruno Mars sibling (memory #32b). Past
  event so hard-delete deferred to the future hard-delete cleanup
  pass; retire keeps the row available for any free-text-orphan
  resolution that surfaces post-V2.
- **`10_merge_carolina.sql`** — corrective. TRUE merge for Carolina
  Country Music Fest (memory #32a). Copies source's shifts onto
  target, re-points quote_lines.shift_id, re-points the quote +
  every other id-anchored reference, then deletes source. Freeze
  triggers disabled inside the transaction. ⚠ TIME-PRESSURED:
  event is 2026-05-31.

## Prod cutover playbook (run in order)

1. `01_audit_drafts.sql` — size the problem on prod.
2. `02_fix_drafts.sql` — fix drafts + backfill legacy paid invoices.
3. Re-run `01` — every count should be 0.
4. `03_audit_frozen.sql` — review output. Default action per row is
   "leave alone" (original PDF stands as historical record). Save
   the output to a worksheet for Connor's later review; only
   actively revise rows where the math is clearly broken AND he's
   reachable for the call.
5. `04_audit_deposits.sql` — same disposition for Checks 2, 2b, 3.
   Check 1 results auto-cleaned by step 6.
6. `05_fix_deposit_stray_lines.sql` — auto-cleans Check 1 stray
   lines where `lines_sum == subtotal` (safe, displayed values
   unchanged).
7. Re-run `04` Check 1 — should return 0 rows.
8. `06_audit_duplicate_jobs.sql` — review per-row reference counts
   for the four duplicate clusters. Confirms each merge is safe to
   run.
9. `07_merge_ky_event.sql` — delete 2 empty KY Event siblings.
10. `08_merge_revival_night.sql` — delete 1 empty Revival Night
    sibling.
11. `09_retire_bruno_mars.sql` — retire abandoned Bruno Mars sibling.
12. `10_merge_carolina.sql` — merge Carolina Country Music Fest
    (⚠ event is 2026-05-31).
13. Re-run `06` — every source-row reference count should be 0.

## Why these live in `docs/`, not `supabase/migrations/`

Per the project rule (see `project_pdf_data_recovery.md` memory note),
data ops stay outside `supabase/migrations/`. Migrations are
schema-only; one-off data fixes go elsewhere so they don't get
auto-replayed on a future fresh-clone migration run. `recovery/` is
gitignored entirely (contains client PDFs), so we use `docs/` for
anything that needs to survive in git.
