-- ============================================================================
-- Legacy job-sheet timesheet linking — data-only fix (PROD)
-- Drafted 2026-06-11. Run manually in the Supabase SQL editor (prod).
--
-- Background: 5 legacy timesheets (created via the retired Job Sheets flow)
-- have job_id IS NULL. Their 52 entries are being linked to the real
-- job_requests they belong to, so the data remains queryable after the
-- job-sheets code is removed.
--
-- Deliberate choices:
--   * ENTRY-level linking only. timesheets.job_id stays NULL on these 5
--     rows so they never surface in the timekeeping job picker
--     (getTimesheetByJobId does a first-match find; setting job_id on a
--     second timesheet for a job would collide with the canonical one).
--   * No new records, no merges, no deletes. UPDATEs only.
--   * The job_sheets table is retained as-is for historical reference
--     (client / event / venue detail lives there).
--
-- Safety: none of the 52 entries have invoice_line_id set, so the
-- timesheet_entries_freeze_check trigger does not block these updates.
-- ============================================================================

BEGIN;

-- ── Pre-check: expect 52 unlinked entries across the 5 legacy timesheets ──
-- (run standalone before COMMIT if you want to eyeball it)
-- SELECT timesheet_id, count(*) FROM timesheet_entries
-- WHERE timesheet_id IN (
--   'timesheet-jobsheet-1779650293913','timesheet-jobsheet-1778082302077',
--   'timesheet-jobsheet-1774844548762','timesheet-jobsheet-1774846277546',
--   'timesheet-jobsheet-1774846347019')
--   AND job_id IS NULL
-- GROUP BY timesheet_id;

-- 1. Rhino Staging — WWE, Schottenstein Center, 2026-05-25 (15 entries)
--    job sheet jobsheet-1779650293913 → AES_260525_RHI_WWE
UPDATE timesheet_entries
SET job_id = 'jobreq-1779649142085'
WHERE timesheet_id = 'timesheet-jobsheet-1779650293913'
  AND job_id IS NULL;

-- 2. Rhino Staging — LOAD IN/OUT, Smoothie King Center, 2026-05-07 (11 entries)
--    job sheet jobsheet-1778082302077 → AES_260507_RHI_LOADINOU
UPDATE timesheet_entries
SET job_id = 'jobreq-1778082223093'
WHERE timesheet_id = 'timesheet-jobsheet-1778082302077'
  AND job_id IS NULL;

-- 3. Loud and Clear — Spring Concert, Mount St Joseph, 2026-04-17 (13 entries)
--    job sheet jobsheet-1774844548762 → AES_26041718_LNC_MOUNTSTJ
UPDATE timesheet_entries
SET job_id = 'jobreq-1775744267941'
WHERE timesheet_id = 'timesheet-jobsheet-1774844548762'
  AND job_id IS NULL;

-- 4. Sunbelt Ground Protection — Flooring Install, 2026-03-28 (9 + 4 entries,
--    two duplicate legacy sheets for the same job)
--    jobsheet-1774846277546 + jobsheet-1774846347019 → AES_260328_SUN_FLOORING
UPDATE timesheet_entries
SET job_id = 'jobreq-sunbelt-flooring-260328'
WHERE timesheet_id IN ('timesheet-jobsheet-1774846277546',
                       'timesheet-jobsheet-1774846347019')
  AND job_id IS NULL;

-- 5. Reject the lone approved WWE entry (AES-02352, clock-in 06:00, no
--    clock-out). It is a check-in stub; left approved it would become
--    eligible for invoice pulls on the WWE job now that it has a job_id.
UPDATE timesheet_entries
SET status = 'rejected'
WHERE timesheet_id = 'timesheet-jobsheet-1779650293913'
  AND employee_key = 'AES-02352'
  AND status = 'approved';

-- 6. Reject the 9 Spring Concert duplicates: submitted entries on the
--    orphan sheet whose (employee, work_date) already exists on the
--    canonical approved timesheet for the same job
--    (timesheet-jobsheet-1776446932434, 24 entries / 22 approved).
--    Guards against double-billing if unapproved-entry invoice pulls ever
--    ship. The 4 non-overlapping entries stay 'submitted' for Connor.
UPDATE timesheet_entries a
SET status = 'rejected'
WHERE a.timesheet_id = 'timesheet-jobsheet-1774844548762'
  AND a.status = 'submitted'
  AND EXISTS (
    SELECT 1 FROM timesheet_entries b
    WHERE b.timesheet_id = 'timesheet-jobsheet-1776446932434'
      AND b.employee_key = a.employee_key
      AND b.work_date    = a.work_date
  );

-- ── Post-check: every entry on the 5 legacy timesheets now has a job_id ──
DO $$
DECLARE unlinked int;
BEGIN
  SELECT count(*) INTO unlinked FROM timesheet_entries
  WHERE timesheet_id IN (
    'timesheet-jobsheet-1779650293913','timesheet-jobsheet-1778082302077',
    'timesheet-jobsheet-1774844548762','timesheet-jobsheet-1774846277546',
    'timesheet-jobsheet-1774846347019')
    AND job_id IS NULL;
  IF unlinked > 0 THEN
    RAISE EXCEPTION 'Post-check failed: % entries still unlinked', unlinked;
  END IF;
END $$;

COMMIT;

-- ── Expected row counts ──
--   step 1: 15   step 2: 11   step 3: 13   step 4: 13
--   step 5: 1    step 6: 9
--
-- ── Verification after commit ──
-- SELECT t.id, count(e.id) AS entries, count(e.job_id) AS linked,
--        count(*) FILTER (WHERE e.status='rejected')  AS rejected,
--        count(*) FILTER (WHERE e.status='submitted') AS still_submitted
-- FROM timesheets t JOIN timesheet_entries e ON e.timesheet_id = t.id
-- WHERE t.job_id IS NULL
-- GROUP BY t.id ORDER BY t.id;
-- Expect: 52 entries, 52 linked; Spring Concert sheet shows 9 rejected,
-- 4 still_submitted (Connor to review those 4).
