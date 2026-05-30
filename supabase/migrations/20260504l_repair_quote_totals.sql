-- One-shot repair: drafts saved before the createDraftFromJob fix had
-- quote.total = 0 even though their lines had computed totals. Recompute
-- stored total + deposit from the lines so display matches storage.
--
-- Idempotent — re-running on already-correct data is a no-op (the WHERE
-- clause filters to only rows where ROUND(stored * 100) <> ROUND(sum * 100)).
--
-- Frozen quotes are intentionally excluded. Their totals were stored as part
-- of the original draft → issue flow; if any are wrong, the fix is to Revise
-- and issue a new revision, not bulk-edit frozen historical records.

UPDATE quotes q
   SET total   = ROUND(line_total * 100) / 100,
       deposit = ROUND(line_total * (COALESCE(q.deposit_pct, 0) / 100.0) * 100) / 100
  FROM (
    SELECT quote_id, SUM(total) AS line_total
      FROM quote_lines
     GROUP BY quote_id
  ) sums
 WHERE q.id = sums.quote_id
   AND q.is_draft = true
   AND ROUND(q.total * 100) <> ROUND(sums.line_total * 100);

-- Drafts with zero lines that somehow have a non-zero total: zero them out.
UPDATE quotes
   SET total = 0, deposit = 0
 WHERE is_draft = true
   AND total > 0
   AND id NOT IN (SELECT DISTINCT quote_id FROM quote_lines);
