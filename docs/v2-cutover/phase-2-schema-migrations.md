# Phase 2 — Schema migrations

Goal: apply all 50 schema migrations to prod in dependency order.

Prereq: Phase 1 complete.

## How to run each migration

For each file in each group below:
1. Open `supabase/migrations/<file>.sql` in editor
2. Copy entire contents
3. Paste into prod Supabase SQL Editor
4. Run
5. Read NOTICE output (most migrations print row counts)
6. Mark off here, move to next

If a migration fails: STOP. Do not proceed. Read the error, compare
against the migration's own documented pre-flight assumptions, decide
to fix-and-retry or abort the cutover.

---

## Group A — Quote rewrite + job_no (16 files)

- [ ] `20260503a_job_requests_job_no.sql` — adds job_no + event_abbr columns, backfills
- [ ] `20260503b_job_requests_job_no_unique.sql` — unique index + event_abbr CHECK
- [ ] `20260503c_job_request_assignments.sql` — new assignments table
- [ ] `20260503d_audit_columns_first_pass.sql` — audit cols on 9 tables + shared trigger
- [ ] `20260504a_master_rate_card_seed.sql` — master default rate card profile
- [ ] `20260504b_employee_documents.sql` — normalize jsonb → child table
- [ ] `20260504c_quotes_extend_for_rewrite.sql` — is_draft + FKs + status normalization
- [ ] `20260504d_quotes_freeze_trigger.sql` — freeze trigger on quotes + quote_lines
- [ ] `20260504e_issue_quote_draft_rpc.sql` — issue_quote_draft RPC
- [ ] `20260504f_quotes_status_drop_not_null.sql` — drop NOT NULL on status
- [ ] `20260504g_seed_master_rate_card_terms.sql` — backfill terms text
- [ ] `20260504h_job_requests_rate_card_override.sql` — rate_card_profile_id FK
- [ ] `20260504i_crew_needs_hours.sql` — per-position hours column
- [ ] `20260504j_quotes_prepared_by.sql` — prepared_by_name/title
- [ ] `20260504k_quotes_deposit_pct.sql` — deposit_pct column + backfill
- [ ] `20260504l_repair_quote_totals.sql` — recompute drafts' stored totals

---

## Group B — Company + quote cleanup + orphan link (3 files)

- [ ] `20260505a_company_settings.sql` — singleton company_settings
- [ ] `20260505b_drop_quote_legacy_pass_1.sql` — drop quote_draft_workspaces + legacy cols
- [ ] `20260506a_link_orphan_quote.sql` — link_orphan_quote RPC + relaxed freeze

---

## Group C — Phase C invoice rewrite (6 files, ALL must run)

⚠ All six are part of the same logical bundle. Don't stop mid-group.

- [ ] `20260506b_invoices_extend_for_rewrite.sql` — Migration 1 (extends invoices)
- [ ] `20260506c_invoice_lines_source_kind.sql` — Migration 2 (source discriminator)
- [ ] `20260506d_invoices_freeze_trigger.sql` — Migration 3 (freeze trigger)
- [ ] `20260506e_customer_payments.sql` — Migration 4 (invoice_payments)
- [ ] `20260506f_customer_credit_ledger.sql` — Migration 5 (credit ledger)
- [ ] `20260506g_invoice_rpcs.sql` — Migration 6 (issue + link + apply_credit RPCs)

---

## Group D — Line model + shifts + holiday + delete-protection (10 files)

- [ ] `20260510a_timesheet_entries_invoice_line_fk.sql` — FK + index, drops obsolete col
- [ ] `20260510b_delete_protection_fk_audit.sql` — 6 text→FK conversions
- [ ] `20260511a_lines_explicit_ot_dt_crew.sql` — ot_hours/dt_hours/crew_count + backfill
- [ ] `20260512a_job_request_shifts.sql` — shifts table + drop free-text shift_label
- [ ] `20260524a_crew_needs_assignments_shift_id.sql` — shift_id on crew side
- [ ] `20260524b_job_request_days_is_holiday.sql` — is_holiday flag on days
- [ ] `20260524c_quote_days.sql` — quote_days snapshot table + trigger + backfill
- [ ] `20260524d_invoice_days.sql` — invoice_days snapshot table + trigger + backfill
- [ ] `20260525a_drop_line_holiday_hours.sql` — drop holiday_hours from lines
- [ ] `20260525b_rate_card_holiday_multiplier.sql` — holiday_multiplier on 3 tables

---

## Group E — Timekeeping rewrite (6 files)

- [ ] `20260525c_timesheets_job_id.sql` — job_id FK + scoring backfill
- [ ] `20260525d_timesheet_entries_freeze.sql` — freeze trigger on entries
- [ ] `20260526a_timesheet_entries_shift_id.sql` — shift_id on entries
- [ ] `20260526b_timesheet_entries_position_specialty.sql` — position_id + specialty_id
- [ ] `20260526c_timesheet_entries_holiday.sql` — is_holiday + holiday_multiplier
- [ ] `20260526d_timesheets_audit_columns.sql` — audit cols on both tables

---

## Group F — Attachment + invoice trigger + payroll + employees (8 files)

- [ ] `20260527a_job_request_attachments_timesheet_doc_type.sql` — add 'timesheet' doc_type
- [ ] `20260527b_release_entries_on_invoice_supersede.sql` — release trigger
- [ ] `20260527c_invoice_auto_paid_status.sql` — auto-flip status on paid_amount
- [ ] `20260528a_payroll_runs.sql` — payroll_runs + entries + triggers
- [ ] `20260528b_timesheet_entries_rates_to_bill.sql` — column rename
- [ ] `20260528c_timesheet_entries_payroll_run_id.sql` — payroll FK + super-freeze
- [ ] `20260528d_pay_rates_on_rate_card_and_employees.sql` — pay rate columns
- [ ] `20260528e_employees_hire_date.sql` — hire_date column

---

## Phase 2 complete when

All 49 boxes above checked. (50 minus the duplicate-numbered `20260528b`
that was renamed — only 1 file at that prefix.)

Run sanity baseline (Phase 0 Section 8 table counts) again on prod.
Compare to pre-migration baseline. Most counts should match exactly;
new tables should show non-zero (payroll_runs, customer_payments,
job_request_shifts, quote_days, invoice_days, employee_documents).

Proceed to Phase 3.
