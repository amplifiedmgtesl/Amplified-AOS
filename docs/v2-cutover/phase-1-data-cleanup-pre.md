# Phase 1 — Pre-migration data cleanups

Goal: clean up data that the Phase 2 schema migrations would otherwise
trip over.

Prereq: Phase 0 complete, snapshot taken, audits reviewed.

---

## Step 1a — Delete header-row employee (memory #7a)

Why: `AES-02343` is a spreadsheet header row that got imported as an
employee. Zero references on dev confirmed; same on prod.

```sql
DELETE FROM employees WHERE employee_key = 'AES-02343';
-- Expect: DELETE 1
```

Expected: `DELETE 1`. If 0, the row was already gone — proceed.

---

## Step 1b — Normalize employees.state to 2-letter codes (memory #7)

Why: legacy data has mix of "Ohio", "OH", "OHIO", etc. New form enforces
2-letter dropdown; this cleans legacy.

```sql
UPDATE employees
SET state = CASE
  WHEN state_code IS NOT NULL AND state_code ~ '^[A-Za-z]{2}$' THEN upper(state_code)
  WHEN upper(trim(state)) = 'OHIO'           THEN 'OH'
  WHEN upper(trim(state)) = 'TEXAS'          THEN 'TX'
  WHEN upper(trim(state)) = 'FLORIDA'        THEN 'FL'
  WHEN upper(trim(state)) = 'WEST VIRGINIA'  THEN 'WV'
  WHEN upper(trim(state)) = 'GEORGIA'        THEN 'GA'
  WHEN upper(trim(state)) = 'MICHIGAN'       THEN 'MI'
  WHEN upper(trim(state)) = 'ARIZONA'        THEN 'AZ'
  WHEN upper(trim(state)) = 'COLORADO'       THEN 'CO'
  WHEN upper(trim(state)) = 'MISSOURI'       THEN 'MO'
  WHEN upper(trim(state)) = 'NORTH CAROLINA' THEN 'NC'
  WHEN upper(trim(state)) = 'INDIANA'        THEN 'IN'
  WHEN upper(trim(state)) = 'OKLAHOMA'       THEN 'OK'
  WHEN upper(trim(state)) = 'SOUTH CAROLINA' THEN 'SC'
  WHEN upper(trim(state)) = 'VIRGINIA'       THEN 'VA'
  WHEN upper(trim(state)) = 'MINNESOTA'      THEN 'MN'
  WHEN upper(trim(state)) = 'KENTUCKY'       THEN 'KY'
  WHEN upper(trim(state)) = 'ILLINOIS'       THEN 'IL'
  WHEN upper(trim(state)) = 'PENNSYLVANIA'   THEN 'PA'
  WHEN upper(trim(state)) = 'TENNESSEE'      THEN 'TN'
  WHEN upper(trim(state)) = 'CALIFORNIA'     THEN 'CA'
  WHEN upper(trim(state)) = 'ALABAMA'        THEN 'AL'
  WHEN upper(trim(state)) = 'NEW YORK'       THEN 'NY'
  WHEN upper(trim(state)) = 'NEW JERSEY'     THEN 'NJ'
  WHEN upper(trim(state)) = 'MASSACHUSETTS'  THEN 'MA'
  WHEN upper(trim(state)) = 'MARYLAND'       THEN 'MD'
  WHEN upper(trim(state)) = 'STATE/PROVINCE' THEN NULL
  WHEN length(trim(state)) = 2 THEN upper(trim(state))
  ELSE state
END
WHERE state IS NOT NULL AND state <> '';
```

Expected: ~77 rows updated (dev count). Prod should be similar since
data predates dev/prod split.

---

## Step 1c — Delete empty job_request siblings (memory #2)

Why: original Connor import created duplicate rows. KY Event has 3 (keep
1), Revival Night has 2 (keep 1). Verify zero external refs first.

```sql
-- Verify nothing references the to-delete rows; every count must be 0.
SELECT 'quotes' AS tbl, count(*) FROM quotes
  WHERE linked_job_request_id IN ('jobreq-1775346126232','jobreq-1775345942610','jobreq-1775227265513')
UNION ALL SELECT 'calendar_events', count(*) FROM calendar_events
  WHERE linked_job_request_id IN ('jobreq-1775346126232','jobreq-1775345942610','jobreq-1775227265513')
UNION ALL SELECT 'job_costing_drafts', count(*) FROM job_costing_drafts
  WHERE linked_job_request_id IN ('jobreq-1775346126232','jobreq-1775345942610','jobreq-1775227265513')
UNION ALL SELECT 'attachments', count(*) FROM job_request_attachments
  WHERE job_request_id IN ('jobreq-1775346126232','jobreq-1775345942610','jobreq-1775227265513');
```

Expected: all 4 rows return `0`.

Only if all four are 0, then run:

```sql
DELETE FROM job_requests
WHERE id IN ('jobreq-1775346126232','jobreq-1775345942610','jobreq-1775227265513');
-- Expect: DELETE 3
```

Expected: `DELETE 3`. Cascade auto-removes corresponding `job_request_days`.

---

## Step 1d — Supersede duplicate active invoices (pre-step before #23)

Why: migration #23's partial unique indices (`invoices_one_active_deposit_per_job`,
`invoices_one_active_wholejob_final_per_job`) fail to create if any job
has multiple non-superseded/non-void invoices of the same type.

Phase 0 Section 3 surfaced 4 clusters (Loud&Clear jobs `1775073944709`
and `1777325737896`). The supersede decisions are pre-baked in
`phase-1-invoice-supersedes.sql`.

```sql
-- Paste contents of: docs/v2-cutover/phase-1-invoice-supersedes.sql
```

Expected NOTICE:
```
Cluster 1 (jobreq-1775073944709): deposits_active=1, finals_active=1
Cluster 2 (jobreq-1777325737896): deposits_active=1, finals_active=1
```

If the post-flight RAISE EXCEPTION fires, the transaction rolls back —
re-read the audit output, decide which row to keep instead, adjust the
script's UPDATE IDs, retry.

After completion, re-run Phase 0 Section 3a + 3b. Both must return zero
rows.

---

## Phase 1 complete when

- [ ] 1a `DELETE 1` (or already absent)
- [ ] 1b ~77 rows updated
- [ ] 1c `DELETE 3`
- [ ] 1d Phase 0 Section 3 re-run returns 0 rows

Proceed to Phase 2.
