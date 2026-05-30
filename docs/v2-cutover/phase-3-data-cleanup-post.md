# Phase 3 — Post-migration data cleanups

Goal: clean up data that only became cleanable AFTER the schema
migrations installed FKs + new id columns.

Prereq: Phase 2 complete, table-count baseline matches expectations.

---

## Step 3a — Luke Combs job_sheet repair + assignments backfill (memory #5)

Why: two `job_sheets` rows have a slug-style `source_event_id` that
should point at real `job_requests` IDs. Plus backfill from existing
`job_sheet_workers` rows into the new `job_request_assignments` table.

```sql
UPDATE job_sheets SET source_event_id = 'jobreq-1776734819124'
  WHERE source_event_id = 'rhino-staging--luke-combs---osu--2026-04-21' AND date = '2026-04-21';
UPDATE job_sheets SET source_event_id = 'jobreq-1776229709021'
  WHERE source_event_id = 'rhino-staging--luke-combs---osu--2026-04-21' AND date = '2026-04-25';
```

Expected: `UPDATE 1` for each statement.

For the assignments backfill INSERT, copy from `20260503c_job_request_assignments.sql`
companion notes (the two-path backfill SQL committed in dev).

---

## Step 3b — Drop bogus Forklift Operator/Labor specialty (memory #30)

Why: `spc-1776715035819` was added via UI later, doesn't match the
`spc-NN-NN` ID convention, duplicates a legitimate specialty name.

✅ Phase 0 Section 6 confirmed prod has **ZERO references** across all 4
referrer tables. Simplified to a single DELETE:

```sql
DELETE FROM specialties WHERE id = 'spc-1776715035819';
-- Expect: DELETE 1
```

Expected: `DELETE 1`. If 0, the row was already removed — proceed.

---

## Step 3c — Re-point legacy text-only timesheet_entries position (memory #38)

Why: after migration #35's backfill, some entries still have `position_id IS NULL`
because their text didn't match the master list. Phase 0 Section 7 showed
the distribution.

⚠ If Phase 0 Section 7 surfaced text values OTHER than `Crew` or `Fork Op`,
add UPDATE clauses for each before running this block.

```sql
-- Verify what's outstanding:
SELECT TRIM(position) AS pos, count(*) AS rows
FROM timesheet_entries
WHERE position_id IS NULL AND NULLIF(TRIM(position),'') IS NOT NULL
GROUP BY 1 ORDER BY count(*) DESC;

-- Apply:
ALTER TABLE timesheet_entries DISABLE TRIGGER timesheet_entries_freeze_iud_trg;

UPDATE timesheet_entries SET position_id = 'pos-01'
  WHERE position_id IS NULL AND lower(TRIM(position)) = 'crew';
UPDATE timesheet_entries SET position_id = 'pos-08'
  WHERE position_id IS NULL AND lower(TRIM(position)) = 'fork op';

ALTER TABLE timesheet_entries ENABLE TRIGGER timesheet_entries_freeze_iud_trg;
```

Expected: ~24 + ~1 = ~25 rows updated (dev count). Re-run the verify
SELECT — should return zero rows.

---

## Step 3d — Audit duplicate job_request clusters

Why: confirm the merge scripts will run cleanly against actual post-
migration prod state.

```sql
-- Paste contents of: docs/data-integrity/06_audit_duplicate_jobs.sql
```

Expected output:
- Section A: 9 rows, shape matches memory #2 + #32
- Section B: ideally zero free-text orphan rows

If Section B returns rows: each needs a per-row decision — tag onto
surviving job manually, or leave as text-only history. Document in log.

---

## Step 3e — Merge KY Event (3→1)

```sql
-- Paste contents of: docs/data-integrity/07_merge_ky_event.sql
```

Expected NOTICE: `keeper exists=1, siblings remaining=0`

---

## Step 3f — Merge Revival Night (2→1)

```sql
-- Paste contents of: docs/data-integrity/08_merge_revival_night.sql
```

Expected NOTICE: `keeper exists=1, sibling remaining=0`

---

## Step 3g — Retire Bruno Mars sibling

```sql
-- Paste contents of: docs/data-integrity/09_retire_bruno_mars.sql
```

Expected NOTICE: `abandoned sibling status=cancelled`

---

## Step 3h — Merge Carolina (TRUE MERGE)

⚠ Time-pressured: Carolina event is 2026-05-31. Even if cutover slips,
this MUST happen before that date.

⚠ Source row drift since memory was written: prod now has **2 quotes
with 159 total lines** on the source (vs memory's 1 quote / 79 lines).
The merge script handles N quotes — pre-flight NOTICE will print
`src quotes to move=2` and the post-flight will show `quote_lines=159`.
This is expected, not a problem.

```sql
-- Paste contents of: docs/data-integrity/10_merge_carolina.sql
```

Expected NOTICE chain (UPDATED for prod's 2-quote shape):
- `Carolina pre-flight: target days=10, crew_needs=40, src quotes to move=2`
- `Carolina merge: all references re-pointed cleanly.`
- `Carolina post-flight: target has quotes=2, quote_lines=159, crew_needs=40, attachments=1. Source still exists=false`

---

## Step 3i — Re-audit duplicate clusters

```sql
-- Paste contents of: docs/data-integrity/06_audit_duplicate_jobs.sql
```

Expected: every SOURCE-side row (DELETE / RETIRE / MERGE FROM) shows
`exists_ = NULL` or for Bruno Mars `exists_ = 1 status='cancelled'`.
All FK reference columns to source ids show 0.

---

## Phase 3 complete when

- [ ] 3a Luke Combs UPDATEs `1 + 1`
- [ ] 3b Specialty `DELETE 1` + UPDATE counts match Phase 0 Section 6
- [ ] 3c Position re-points succeed, verify returns 0
- [ ] 3d Audit clean
- [ ] 3e-h All four merge scripts complete with expected NOTICE
- [ ] 3i Re-audit confirms zero source-side refs

Proceed to Phase 4.
