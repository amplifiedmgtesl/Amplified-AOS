-- ════════════════════════════════════════════════════════════════════
-- V2 CUTOVER — PROD PRE-FLIGHT AUDIT (read-only)
--
-- Run on PROD (wmssllfmahotppoyxxrr) the evening before cutover. Sizes
-- every known risk against actual prod data so we know what we're
-- walking into in the morning instead of discovering surprises mid-
-- cutover.
--
-- ALL SECTIONS ARE READ-ONLY. Pure SELECTs. No data modified.
--
-- Run each section, paste the results back. We'll use the numbers to:
--   * Confirm dev/prod data shape is similar enough that the
--     migrations apply cleanly
--   * Surface anything that needs a pre-migration cleanup decision
--   * Validate the duplicate-cluster assumptions in memory
--
-- Sections:
--   1. job_no backfill preview (migration #1 / 20260503a)
--   2. quote status distribution + draft workspace count (#10 / 20260504c)
--   3. Duplicate active deposit + final invoices (pre-step before #23)
--   4. Timekeeping coverage CTE (#31 / 20260525c)
--   5. Duplicate job_request clusters — pre-merge shape (memory #2 + #32)
--   6. Orphan specialty refs (cleanup #30)
--   7. Outstanding text-only timesheet_entries positions (cleanup #38)
--   8. Counts of every key table — sanity baseline
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. job_no backfill preview (migration #1) ───────────────────────
-- Migration #1 adds job_no + event_abbr to job_requests + backfills.
-- This previews what the backfill WOULD produce. The migration aborts
-- cleanly on duplicate job_no — duplicates need the data cleanup in #2
-- to run first.

SELECT
  count(*)                                              AS total_job_requests,
  count(*) FILTER (WHERE client_id IS NOT NULL)         AS with_client_id,
  count(*) FILTER (WHERE request_date IS NULL OR request_date = '') AS no_request_date,
  count(*) FILTER (WHERE event_name IS NULL OR event_name = '')     AS no_event_name
FROM job_requests;

-- ─── 2. Quote status distribution + draft workspace staleness ────────
-- Migration #10 normalizes status 'quoted' → 'issued' and adds is_draft.
-- Pre-flight: confirm only 'quoted' and 'signed' surface; anything else
-- needs the normalization UPDATE adjusted. Also reports stale draft
-- workspaces (#10 truncates these).

SELECT COALESCE(status,'(null)') AS status, count(*) AS rows
FROM quotes GROUP BY 1 ORDER BY 2 DESC;

SELECT count(*) AS stale_draft_workspaces FROM quote_draft_workspaces;

-- ─── 3. Duplicate active invoices (pre-step before migration #23) ────
-- #23's partial unique indices fail if any job has multiple non-
-- superseded/non-void invoices of the same type. Resolution rule:
-- supersede all but the one representing real-world billing reality.

-- 3a. Deposit duplicates
SELECT q.linked_job_request_id AS job_id,
       count(*) AS deposit_count,
       string_agg(i.id, ', ' ORDER BY i.id) AS invoice_ids,
       string_agg(i.invoice_no || ' [' || COALESCE(i.status,'(null)') || ', $' || COALESCE(i.deposit::text,'0') || ']',
                  E'\n  ' ORDER BY i.id) AS detail
  FROM invoices i
  JOIN quotes q ON q.id = i.quote_id
 WHERE i.invoice_no LIKE '%-DEP%'
   AND (i.status IS NULL OR LOWER(i.status) NOT IN ('superseded','void','draft'))
   AND q.linked_job_request_id IS NOT NULL
 GROUP BY q.linked_job_request_id
HAVING count(*) > 1;

-- 3b. Final duplicates
SELECT q.linked_job_request_id AS job_id,
       count(*) AS final_count,
       string_agg(i.id, ', ' ORDER BY i.id) AS invoice_ids,
       string_agg(i.invoice_no || ' [' || COALESCE(i.status,'(null)') || ']', E'\n  ' ORDER BY i.id) AS detail
  FROM invoices i
  JOIN quotes q ON q.id = i.quote_id
 WHERE i.invoice_no NOT LIKE '%-DEP%'
   AND (i.status IS NULL OR LOWER(i.status) NOT IN ('superseded','void','draft'))
   AND q.linked_job_request_id IS NOT NULL
 GROUP BY q.linked_job_request_id
HAVING count(*) > 1;

-- ─── 4. Timekeeping coverage (migration #31) ────────────────────────
-- #31 backfills timesheets.job_id from job_sheets via a scoring
-- heuristic. Auto-applies only score >= 13 (high confidence). Preview
-- what will/won't link.

WITH ts AS (
  SELECT t.id AS ts_id,
         TRIM(js.client) AS js_client,
         NULLIF(TRIM(js.date),'')::date AS js_date,
         TRIM(js.event_name) AS js_event
  FROM timesheets t JOIN job_sheets js ON js.id = t.job_sheet_id
  WHERE NULLIF(TRIM(js.date),'') IS NOT NULL
), ts_with_client AS (
  SELECT ts.*, (SELECT c.id FROM clients c WHERE lower(c.name)=lower(ts.js_client) LIMIT 1) AS resolved_client_id FROM ts
), candidates AS (
  SELECT ts.ts_id, jr.id AS jr_id,
         (CASE WHEN jr.client_id IS NOT NULL AND jr.client_id = ts.resolved_client_id THEN 10 ELSE 0 END
          + CASE WHEN lower(TRIM(jr.client)) = lower(ts.js_client) THEN 5 ELSE 0 END
          + CASE WHEN lower(TRIM(jr.event_name)) = lower(ts.js_event) THEN 8
                 WHEN lower(TRIM(jr.event_name)) LIKE '%' || lower(ts.js_event) || '%'
                   OR lower(ts.js_event) LIKE '%' || lower(TRIM(jr.event_name)) || '%' THEN 4 ELSE 0 END) AS score
  FROM ts_with_client ts
  JOIN job_requests jr ON (jr.client_id = ts.resolved_client_id OR lower(TRIM(jr.client)) = lower(ts.js_client))
    AND ts.js_date BETWEEN NULLIF(jr.request_date,'')::date AND COALESCE(NULLIF(jr.end_date,'')::date, NULLIF(jr.request_date,'')::date)
), best AS (
  SELECT ts_id, jr_id, score, ROW_NUMBER() OVER (PARTITION BY ts_id ORDER BY score DESC, jr_id) AS rn,
         COUNT(*) OVER (PARTITION BY ts_id) AS cands FROM candidates
)
SELECT
  (SELECT count(*) FROM best WHERE rn=1 AND score >= 13)             AS auto_linked,
  (SELECT count(*) FROM best WHERE rn=1 AND score BETWEEN 1 AND 12)  AS weak_match,
  (SELECT count(*) FROM timesheets) - (SELECT count(DISTINCT ts_id) FROM best) AS unmatched,
  (SELECT count(*) FROM timesheets)                                  AS total_timesheets;

-- ─── 5. Duplicate job_request clusters — pre-merge shape ─────────────
-- Validates memory #2 + #32 against current prod state. Row shape
-- (days/needs/quotes) should roughly match dev's audit output.

WITH targets(id, label) AS (
  VALUES
    ('jobreq-1775346228492','KY Event   — KEEP'),
    ('jobreq-1775346126232','KY Event   — DELETE'),
    ('jobreq-1775345942610','KY Event   — DELETE'),
    ('jobreq-1775344443515','Revival    — KEEP'),
    ('jobreq-1775227265513','Revival    — DELETE'),
    ('jobreq-1778094212255','Bruno Mars — KEEP'),
    ('jobreq-1777684960205','Bruno Mars — RETIRE'),
    ('jobreq-1779670159567','Carolina   — KEEP'),
    ('jobreq-1778348194976','Carolina   — MERGE FROM')
)
SELECT
  t.label,
  t.id,
  (SELECT 1 FROM job_requests WHERE id = t.id)                              AS exists_,
  (SELECT count(*) FROM job_request_days        WHERE job_request_id = t.id) AS days,
  (SELECT count(*) FROM job_request_attachments WHERE job_request_id = t.id) AS attach,
  (SELECT count(*) FROM job_request_crew_needs cn
     JOIN job_request_days d ON d.id = cn.job_request_day_id
    WHERE d.job_request_id = t.id)                                          AS crew_needs,
  -- Pre-Phase-2: only legacy columns exist
  (SELECT count(*) FROM quotes              WHERE linked_job_request_id = t.id) AS quotes_legacy,
  (SELECT count(*) FROM calendar_events     WHERE linked_job_request_id = t.id) AS cal_events,
  (SELECT count(*) FROM job_costing_drafts  WHERE linked_job_request_id = t.id) AS costing,
  (SELECT count(*) FROM quote_lines ql
     JOIN quotes q ON q.id = ql.quote_id
    WHERE q.linked_job_request_id = t.id)                                   AS quote_lines,
  (SELECT jr.client_id::text || ' / ' || COALESCE(jr.event_name,'') || ' / ' ||
          COALESCE(jr.request_date,'') || ' → ' || COALESCE(jr.end_date,'')
     FROM job_requests jr WHERE jr.id = t.id)                               AS row_shape
FROM targets t
ORDER BY t.label, t.id;

-- ─── 6. Bogus Forklift Operator/Labor specialty refs (cleanup #30) ───
-- Memory #30: drop specialty spc-1776715035819 after re-pointing refs.
-- Dev had 3 refs; prod could have more. Audit first.

SELECT 'rate_card_profile_rows'    AS tbl, count(*)::int AS refs FROM rate_card_profile_rows    WHERE specialty_id = 'spc-1776715035819'
UNION ALL SELECT 'job_request_crew_needs',  count(*)::int FROM job_request_crew_needs  WHERE specialty_id = 'spc-1776715035819'
UNION ALL SELECT 'quote_lines',             count(*)::int FROM quote_lines             WHERE specialty_id = 'spc-1776715035819'
UNION ALL SELECT 'invoice_lines',           count(*)::int FROM invoice_lines           WHERE specialty_id = 'spc-1776715035819';

-- ─── 7. Outstanding text-only timesheet_entries positions (cleanup #38)
-- After migration #35 backfills position_id, anything still NULL gets
-- re-pointed in cleanup #38. Preview what's outstanding. Note: this
-- query runs against TODAY's prod (pre-migration), so all rows will
-- show position_id NULL. The interesting output is the distribution
-- of position TEXT values — anything outside {Crew, Fork Op} needs a
-- decision before #38 runs.

SELECT TRIM(position) AS pos, count(*) AS rows
FROM timesheet_entries
WHERE NULLIF(TRIM(position),'') IS NOT NULL
GROUP BY 1
ORDER BY count(*) DESC;

-- ─── 8. Table count baseline ────────────────────────────────────────
-- One-line sanity row counts on every table that V2 migrations touch.
-- We'll re-run after Phase 2 to confirm nothing went sideways.

SELECT 'job_requests'               AS tbl, count(*) FROM job_requests
UNION ALL SELECT 'job_request_days',          count(*) FROM job_request_days
UNION ALL SELECT 'job_request_attachments',   count(*) FROM job_request_attachments
UNION ALL SELECT 'job_request_crew_needs',    count(*) FROM job_request_crew_needs
UNION ALL SELECT 'clients',                   count(*) FROM clients
UNION ALL SELECT 'quotes',                    count(*) FROM quotes
UNION ALL SELECT 'quote_lines',               count(*) FROM quote_lines
UNION ALL SELECT 'invoices',                  count(*) FROM invoices
UNION ALL SELECT 'invoice_lines',             count(*) FROM invoice_lines
UNION ALL SELECT 'employees',                 count(*) FROM employees
UNION ALL SELECT 'timesheets',                count(*) FROM timesheets
UNION ALL SELECT 'timesheet_entries',         count(*) FROM timesheet_entries
UNION ALL SELECT 'job_sheets',                count(*) FROM job_sheets
UNION ALL SELECT 'job_sheet_workers',         count(*) FROM job_sheet_workers
UNION ALL SELECT 'calendar_events',           count(*) FROM calendar_events
UNION ALL SELECT 'rate_card_profiles',        count(*) FROM rate_card_profiles
UNION ALL SELECT 'rate_card_profile_rows',    count(*) FROM rate_card_profile_rows
UNION ALL SELECT 'client_contacts',           count(*) FROM client_contacts
UNION ALL SELECT 'specialties',               count(*) FROM specialties
UNION ALL SELECT 'positions',                 count(*) FROM positions
ORDER BY tbl;
