# CCMF Carolina invoice backup — 2026-06-11

Pre-change snapshot of the live CCMF draft invoice on **prod**, taken before:
1. running the `manually_edited` migration + flagging Connor's 24 corrected lines,
2. expanding `covered_dates` from 2026-05-31..06-04 to 2026-05-31..06-14,
3. merging the preserve-corrected-lines feature (dev commit `fb31843`) to main.

## What's here

- `invoice_header.json` — billing-relevant header fields of `invoices` row `i-mq1h3qvp-bd8f5xc3`.
  (`terms`/`notes` are NOT snapshotted — no code path in this change touches them.)
- `invoice_lines.json` — all 24 `invoice_lines` rows verbatim (the data Connor hand-corrected; $130,044.70 total).
- `timesheet_entries_link_snapshot.txt` — id / work_date / status / invoice_line_id for all 771
  `timesheet_entries` on job `jobreq-1779670159567`, capturing which entries were back-linked
  to which line before the change (348 approved entries linked to the 24 lines).

## Restore procedure (if a re-pull goes wrong)

1. Delete the bad lines: `DELETE FROM invoice_lines WHERE invoice_id = 'i-mq1h3qvp-bd8f5xc3';`
   (releases any entry back-links via ON DELETE SET NULL)
2. Re-insert the 24 rows from `invoice_lines.json` (same ids).
3. Restore header: `UPDATE invoices SET subtotal = 130044.7, amount_due = 130044.7,
   covered_dates = ARRAY['2026-05-31','2026-06-01','2026-06-02','2026-06-03','2026-06-04']::date[]
   WHERE id = 'i-mq1h3qvp-bd8f5xc3';`
4. Re-link entries per `timesheet_entries_link_snapshot.txt`
   (`UPDATE timesheet_entries SET invoice_line_id = <snap> WHERE id = <snap>` for the 348 linked rows).

Job: AES_26053109_CCM_CAROLINA — CCMF, LLC — Carolina Country Music Fest, Myrtle Beach SC.
All other invoices on the job are superseded; this draft is the only live one.
