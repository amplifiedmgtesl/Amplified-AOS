-- ════════════════════════════════════════════════════════════════════
-- DUPLICATE JOB_REQUEST AUDIT — V2 cutover Phase 3 pre-flight
--
-- Read-only. Run AFTER Phase 2 schema migrations are applied to prod
-- (so the new FK columns + backfills exist and are populated).
--
-- Surfaces every known referrer of the four duplicate clusters:
--   * KY Event (Loud&Clear, 2026-04-05)        — 3 rows total
--   * Revival Night (Alive, 2026-04-17)        — 2 rows total
--   * Bruno Mars (Rhino, 2026-05-16..21)        — 2 rows total
--   * Carolina Country Music Fest              — 2 rows total
--
-- Output gives you the count of every FK / legacy-text pointer per row
-- so you can review BEFORE running the per-cluster merge scripts
-- (07_*, 08_*, 09_*, 10_*).
--
-- Plus a free-text orphan sweep that catches rows naming the same
-- client + date window but missing any id pointer at all.
-- ════════════════════════════════════════════════════════════════════

-- ─── Section A. Per-row reference counts ────────────────────────────
WITH targets(id, label) AS (
  VALUES
    ('jobreq-1775346228492','KY Event   — KEEP (has linked quote)'),
    ('jobreq-1775346126232','KY Event   — DELETE empty sibling'),
    ('jobreq-1775345942610','KY Event   — DELETE empty sibling'),
    ('jobreq-1775344443515','Revival    — KEEP (has notes)'),
    ('jobreq-1775227265513','Revival    — DELETE empty sibling'),
    ('jobreq-1778094212255','Bruno Mars — KEEP (5 days, 12 needs, quote)'),
    ('jobreq-1777684960205','Bruno Mars — RETIRE abandoned (4 days, 6 needs)'),
    ('jobreq-1779670159567','Carolina   — KEEP (40 crew_needs + attachment)'),
    ('jobreq-1778348194976','Carolina   — MERGE FROM (quote w/ 79 lines)')
)
SELECT
  t.label,
  t.id,
  -- Job-level row exists?
  (SELECT 1 FROM job_requests WHERE id = t.id)                              AS exists_,
  -- Job children (CASCADE on delete of parent)
  (SELECT count(*) FROM job_request_days        WHERE job_request_id = t.id) AS days,
  (SELECT count(*) FROM job_request_shifts      WHERE job_request_id = t.id) AS shifts,
  (SELECT count(*) FROM job_request_attachments WHERE job_request_id = t.id) AS attach,
  (SELECT count(*) FROM job_request_crew_needs cn
     JOIN job_request_days d ON d.id = cn.job_request_day_id
    WHERE d.job_request_id = t.id)                                          AS crew_needs,
  (SELECT count(*) FROM job_request_assignments a
     JOIN job_request_days d ON d.id = a.job_request_day_id
    WHERE d.job_request_id = t.id)                                          AS assigns,
  -- Top-level FK references (post-Phase-2 columns)
  (SELECT count(*) FROM quotes              WHERE job_request_id        = t.id) AS quotes_fk,
  (SELECT count(*) FROM invoices            WHERE job_request_id        = t.id) AS invoices_fk,
  (SELECT count(*) FROM timesheets          WHERE job_id                = t.id) AS ts,
  (SELECT count(*) FROM timesheet_entries   WHERE job_id                = t.id) AS ts_entries,
  -- Legacy text columns (still present pre-#21/#23 drops)
  (SELECT count(*) FROM quotes              WHERE linked_job_request_id = t.id) AS quotes_legacy,
  (SELECT count(*) FROM calendar_events     WHERE linked_job_request_id = t.id) AS cal_events,
  (SELECT count(*) FROM job_costing_drafts  WHERE linked_job_request_id = t.id) AS costing,
  -- Quote line count (cascades through quote_id when quote is repointed/kept)
  (SELECT count(*) FROM quote_lines ql
     JOIN quotes q ON q.id = ql.quote_id
    WHERE q.job_request_id = t.id OR q.linked_job_request_id = t.id)        AS quote_lines,
  -- Invoice line count
  (SELECT count(*) FROM invoice_lines il
     JOIN invoices i ON i.id = il.invoice_id
    WHERE i.job_request_id = t.id)                                          AS invoice_lines,
  -- Row identity for visual sanity check
  (SELECT jr.client_id::text || ' / ' || COALESCE(jr.event_name,'') || ' / ' ||
          COALESCE(jr.request_date::text,'') || ' → ' || COALESCE(jr.end_date::text,'')
     FROM job_requests jr WHERE jr.id = t.id)                               AS row_shape
FROM targets t
ORDER BY t.label, t.id;

-- ─── Section B. Free-text orphan sweep ──────────────────────────────
-- Rows that NAME the same client + date window but have NO id pointer.
-- If any rows appear, they're candidates for being tagged onto the
-- surviving job_request by hand (or left as text-only history).

-- B1. Loud&Clear / KY Event neighborhood (Apr 5 2026)
SELECT 'calendar_events' AS tbl, id, title AS name, start_date::text AS the_date, client
  FROM calendar_events
 WHERE linked_job_request_id IS NULL
   AND lower(client) LIKE '%loud%clear%'
   AND start_date BETWEEN '2026-04-03' AND '2026-04-07'
UNION ALL
SELECT 'job_sheets', id, event_name, date, client
  FROM job_sheets
 WHERE (source_event_id IS NULL OR source_event_id NOT LIKE 'jobreq-%')
   AND lower(client) LIKE '%loud%clear%'
   AND date BETWEEN '2026-04-03' AND '2026-04-07'
ORDER BY 1, 3;

-- B2. Alive Productions / Revival Night neighborhood (Apr 17 2026)
SELECT 'calendar_events' AS tbl, id, title AS name, start_date::text, client
  FROM calendar_events
 WHERE linked_job_request_id IS NULL
   AND lower(client) LIKE '%alive%'
   AND start_date BETWEEN '2026-04-15' AND '2026-04-19'
UNION ALL
SELECT 'job_sheets', id, event_name, date, client
  FROM job_sheets
 WHERE (source_event_id IS NULL OR source_event_id NOT LIKE 'jobreq-%')
   AND lower(client) LIKE '%alive%'
   AND date BETWEEN '2026-04-15' AND '2026-04-19'
ORDER BY 1, 3;

-- B3. Rhino Staging / Bruno Mars neighborhood (May 16-21 2026)
SELECT 'calendar_events' AS tbl, id, title AS name, start_date::text, client
  FROM calendar_events
 WHERE linked_job_request_id IS NULL
   AND lower(client) LIKE '%rhino%'
   AND start_date BETWEEN '2026-05-15' AND '2026-05-22'
UNION ALL
SELECT 'job_sheets', id, event_name, date, client
  FROM job_sheets
 WHERE (source_event_id IS NULL OR source_event_id NOT LIKE 'jobreq-%')
   AND lower(client) LIKE '%rhino%'
   AND date BETWEEN '2026-05-15' AND '2026-05-22'
ORDER BY 1, 3;

-- B4. Loud&Clear / Carolina neighborhood (May 31 2026)
SELECT 'calendar_events' AS tbl, id, title AS name, start_date::text, client
  FROM calendar_events
 WHERE linked_job_request_id IS NULL
   AND lower(client) LIKE '%loud%clear%'
   AND start_date BETWEEN '2026-05-29' AND '2026-06-02'
UNION ALL
SELECT 'job_sheets', id, event_name, date, client
  FROM job_sheets
 WHERE (source_event_id IS NULL OR source_event_id NOT LIKE 'jobreq-%')
   AND lower(client) LIKE '%loud%clear%'
   AND date BETWEEN '2026-05-29' AND '2026-06-02'
ORDER BY 1, 3;
