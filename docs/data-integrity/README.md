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

## Prod cutover playbook (run in order)

1. `01_audit_drafts.sql` — size the problem on prod.
2. `02_fix_drafts.sql` — fix drafts + backfill legacy paid invoices.
3. Re-run `01` — every count should be 0.
4. `03_audit_frozen.sql` — share output with Connor. Decide per-row:
   * Leave alone — original PDF stands.
   * Revise — creates a new revision and supersedes the original.
5. `04_audit_deposits.sql` — share Checks 2, 2b, 3 with Connor for
   per-row decision (Check 1 results auto-cleaned by step 6).
6. `05_fix_deposit_stray_lines.sql` — auto-cleans Check 1 stray
   lines where `lines_sum == subtotal` (safe, displayed values
   unchanged).
7. Re-run `04` Check 1 — should return 0 rows.

## Why these live in `docs/`, not `supabase/migrations/`

Per the project rule (see `project_pdf_data_recovery.md` memory note),
data ops stay outside `supabase/migrations/`. Migrations are
schema-only; one-off data fixes go elsewhere so they don't get
auto-replayed on a future fresh-clone migration run. `recovery/` is
gitignored entirely (contains client PDFs), so we use `docs/` for
anything that needs to survive in git.
