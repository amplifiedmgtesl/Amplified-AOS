-- ════════════════════════════════════════════════════════════════════
-- LEGACY QUOTE BACKFILL — Block A: Setup
--
-- Creates:
--   1. QRX quarantine client
--   2. Three quarantine job_requests (Corrupted Slugs, Lost Bids, Recovery Duplicates)
--   3. One Corporate Call job_request (Loud&Clear, real billed but no existing job)
--   4. One Sunbelt Flooring Install job_request (real billed, no existing job)
--
-- Idempotent — ON CONFLICT DO NOTHING on all inserts.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. QRX quarantine client ───────────────────────────────────────
INSERT INTO clients (id, name, code, is_active, notes)
VALUES (
  'clt-qrx-quarantine',
  '_QUARANTINE - Quote Recovery',
  'QRX',
  false,
  'Internal-only client for parking legacy quotes/invoices that need future review with Connor. Not a real customer.'
)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Three quarantine jobs under QRX ─────────────────────────────
INSERT INTO job_requests (id, client_id, client, event_name, event_abbr, request_date, end_date, status, notes)
VALUES
  (
    'jobreq-qrx-corrupted-slugs',
    'clt-qrx-quarantine',
    '_QUARANTINE - Quote Recovery',
    'Quote Recovery - Connor Incident Corrupted Slugs',
    NULL,
    '2026-01-01',
    NULL,
    'cancelled',
    'Holding pen for quote rows whose slug-PK got overwritten in the Connor incident. Each row''s event_name + amount may not match the slug. Review with Connor to map to real events.'
  ),
  (
    'jobreq-qrx-lost-bids',
    'clt-qrx-quarantine',
    '_QUARANTINE - Quote Recovery',
    'Quote Recovery - Lost Bids',
    NULL,
    '2026-01-01',
    NULL,
    'cancelled',
    'Holding pen for quotes on past events that never got invoiced — bids we lost. Preserved for historical reference; no further action expected.'
  ),
  (
    'jobreq-qrx-recovery-dups',
    'clt-qrx-quarantine',
    '_QUARANTINE - Quote Recovery',
    'Quote Recovery - Recovery Duplicates',
    NULL,
    '2026-01-01',
    NULL,
    'cancelled',
    'Holding pen for recovered-* quote rows that duplicate other linked rows, plus typo duplicates. Safe to delete eventually after spot-check.'
  )
ON CONFLICT (id) DO NOTHING;

-- ─── 3. Corporate Call job (Loud&Clear, real billed event) ──────────
INSERT INTO job_requests (id, client_id, client, event_name, event_abbr, request_date, end_date, status, notes)
VALUES (
  'jobreq-corp-call-260331',
  'clt-new-lnc',
  'Loud&Clear, Inc.',
  'Corporate Call',
  'CORPCAL',
  '2026-03-31',
  NULL,
  'booked',
  'Backfilled from V2 cutover 2026-05-30. Loud&Clear Corporate Call event 2026-03-31. The quote loud-&-clear-inc-kyle-weimer-...-corporate-call-2026-03-31 ($370, signed Mar 30) was billed via INV-2026-0330-246 and paid. Job_request was missing — created retroactively to satisfy V2 FK requirements.'
)
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Sunbelt Flooring Install job (real billed, no existing job) ─
INSERT INTO job_requests (id, client_id, client, event_name, event_abbr, request_date, end_date, status, notes)
VALUES (
  'jobreq-sunbelt-flooring-260328',
  'clt-ad61aaef5cd35ccaa04d0a1245456058',
  'Sunbelt Ground Protection Division',
  'Flooring Install',
  'FLOORING',
  '2026-03-28',
  NULL,
  'booked',
  'Backfilled from V2 cutover 2026-05-30. Sunbelt Ground Protection Division Flooring Install event 2026-03-28. PDF (SUN_260328_SC) confirms $540 billed via INV-2026-0330-627. Job_request was missing — created retroactively.'
)
ON CONFLICT (id) DO NOTHING;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  n_clients int;
  n_jobs int;
BEGIN
  SELECT count(*) INTO n_clients FROM clients WHERE id = 'clt-qrx-quarantine';
  SELECT count(*) INTO n_jobs FROM job_requests
    WHERE id IN ('jobreq-qrx-corrupted-slugs','jobreq-qrx-lost-bids','jobreq-qrx-recovery-dups',
                 'jobreq-corp-call-260331','jobreq-sunbelt-flooring-260328');
  IF n_clients <> 1 OR n_jobs <> 5 THEN
    RAISE EXCEPTION 'Block A setup verification failed: clients=%, jobs=% (expect 1, 5)', n_clients, n_jobs;
  END IF;
  RAISE NOTICE 'Block A setup complete: % QRX client, % new jobs (3 quarantine + 2 real)', n_clients, n_jobs;
END;
$$;

COMMIT;
