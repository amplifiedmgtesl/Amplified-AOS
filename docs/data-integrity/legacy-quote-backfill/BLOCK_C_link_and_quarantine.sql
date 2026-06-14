-- ════════════════════════════════════════════════════════════════════
-- LEGACY QUOTE BACKFILL — Block C: Link orphans + quarantine
--
-- Two halves:
--   (1) LINK 10 orphan quotes to their real existing job_requests
--   (2) QUARANTINE 13 quotes + 2 orphan invoices to QRX category jobs
--
-- All updates set job_request_id (and for quarantines, also status='superseded').
-- quote_no stays NULL for quarantined; will be backfilled in Block D for linked ones.
-- Freeze triggers disabled because most of these quotes are is_draft=false.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE quotes        DISABLE TRIGGER quotes_freeze_trg;
ALTER TABLE invoices      DISABLE TRIGGER invoices_freeze_trg;

-- ════════════════════════════════════════════════════════════════════
-- PART 1: LINK orphans to real existing jobs
-- ════════════════════════════════════════════════════════════════════

-- HOF signed orphan → FEP Live job
UPDATE quotes SET job_request_id = 'jobreq-1774997460467'
WHERE id = 'recovered-06a99ec9-pro-football-hall-of-fame-2026-enshrinement-week';

-- Mt St Joseph signed orphan → existing MSJ job
UPDATE quotes SET job_request_id = 'jobreq-1775744267941'
WHERE id = 'recovered-79529235-mount-st-joseph-spring-concert';

-- Scotty signed orphan → existing Morris Farms job
UPDATE quotes SET job_request_id = 'jobreq-1775848667250'
WHERE id = 'recovered-ba7ea741-scotty-mccreery';

-- Miami signed orphan → existing Miami job (becomes base; loud&clear $44826 already on this job becomes REV2)
UPDATE quotes SET job_request_id = 'jobreq-1777325737896'
WHERE id = 'recovered-6e82573f-miami-university-commencement';

-- OCF orphan → existing OCF job
UPDATE quotes SET job_request_id = 'jobreq-1776184326685'
WHERE id = 'recovered-b12d4439-the-ohio-country-fest';

-- KY signed orphan → existing KY Event keeper job
UPDATE quotes SET job_request_id = 'jobreq-1775346228492'
WHERE id = 'recovered-33c5d8eb-ky-event';

-- LBFT orphan → existing Luke Bryan Farm Tour job
UPDATE quotes SET job_request_id = 'jobreq-1779069574308'
WHERE id = 'recovered-a65a9683-2026-farm-tour-california';

-- Warrior Conference orphan → existing Warrior job (one of the two duplicates becomes the keeper here; the other goes to quarantine in Part 2)
UPDATE quotes SET job_request_id = 'jobreq-1777304800150'
WHERE id = 'recovered-1c3e90df-warrior-conference';

-- Sunbelt $540 active quote → newly-created Sunbelt Flooring Install job
UPDATE quotes SET job_request_id = 'jobreq-sunbelt-flooring-260328'
WHERE id = 'sunbelt-ground-protection-division-flooring-install-2026-03-28';

-- Corporate Call $370 → newly-created Corporate Call job
UPDATE quotes SET job_request_id = 'jobreq-corp-call-260331'
WHERE id = 'loud-&-clear-inc---kyle-weimer---10310-julian-dr,-cincinnati,-oh-corporate-call-2026-03-31';

-- ════════════════════════════════════════════════════════════════════
-- PART 2: QUARANTINE quotes
-- ════════════════════════════════════════════════════════════════════

-- ─── 2a. Corrupted slugs (Connor incident) ──────────────────────────
UPDATE quotes
SET job_request_id = 'jobreq-qrx-corrupted-slugs',
    status = 'superseded',
    quote_no = NULL
WHERE id IN (
  'fep-live,-llc-pro-football-hall-of-fame-2026-enshrinement-week-2026-08-05',
  'alive-productions--church-concert-2026-04-10',
  'rhino-staging--luke-combs---osu--2026-04-21'
);

-- ─── 2b. Lost bids (past event + no invoice) ────────────────────────
UPDATE quotes
SET job_request_id = 'jobreq-qrx-lost-bids',
    status = 'superseded',
    quote_no = NULL
WHERE id IN (
  '-manuel-duque---rhino-staging-luke-combs---load-out-2026-04-25',
  'rhino-staging--wwe-2026-05-25',
  'recovered-271a1ffc-liv-golf-dc',
  'loud&clear,-inc.-carolina-country-music-fest-2026-05-31',
  'recovered-74bb42d2-luke-combs-load-out'
);

-- ─── 2c. Recovery duplicates ────────────────────────────────────────
UPDATE quotes
SET job_request_id = 'jobreq-qrx-recovery-dups',
    status = 'superseded',
    quote_no = NULL
WHERE id IN (
  'recovered-3d131e98-warrior-conference',
  'recovered-20871778-osu-stadium-load-out',
  'sunbelt-ground-protections-division-flooring-install-2026-03-28'
);

-- ─── 2d. Orphan invoices (no source_quote_id) → quarantine ──────────
UPDATE invoices
SET job_request_id = 'jobreq-qrx-recovery-dups',
    status = 'superseded'
WHERE id IN (
  'inv-recovered-4e8e21cb',
  'inv-recovered-ff46be24'
);

-- ─── Re-enable freeze triggers ──────────────────────────────────────
ALTER TABLE quotes        ENABLE TRIGGER quotes_freeze_trg;
ALTER TABLE invoices      ENABLE TRIGGER invoices_freeze_trg;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  linked_count int;
  quarantined_q int;
  quarantined_i int;
BEGIN
  SELECT count(*) INTO linked_count FROM quotes
    WHERE id IN (
      'recovered-06a99ec9-pro-football-hall-of-fame-2026-enshrinement-week',
      'recovered-79529235-mount-st-joseph-spring-concert',
      'recovered-ba7ea741-scotty-mccreery',
      'recovered-6e82573f-miami-university-commencement',
      'recovered-b12d4439-the-ohio-country-fest',
      'recovered-33c5d8eb-ky-event',
      'recovered-a65a9683-2026-farm-tour-california',
      'recovered-1c3e90df-warrior-conference',
      'sunbelt-ground-protection-division-flooring-install-2026-03-28',
      'loud-&-clear-inc---kyle-weimer---10310-julian-dr,-cincinnati,-oh-corporate-call-2026-03-31'
    )
    AND job_request_id IS NOT NULL
    AND job_request_id NOT LIKE 'jobreq-qrx-%';

  SELECT count(*) INTO quarantined_q FROM quotes
    WHERE job_request_id LIKE 'jobreq-qrx-%' AND status = 'superseded';

  SELECT count(*) INTO quarantined_i FROM invoices
    WHERE job_request_id LIKE 'jobreq-qrx-%';

  IF linked_count <> 10 THEN
    RAISE EXCEPTION 'Block C link verification failed: linked=% (expect 10)', linked_count;
  END IF;
  IF quarantined_q <> 11 THEN
    RAISE EXCEPTION 'Block C quarantine quotes verification failed: %=% (expect 11)', 'quarantined_q', quarantined_q;
  END IF;
  IF quarantined_i <> 2 THEN
    RAISE EXCEPTION 'Block C quarantine invoices verification failed: quarantined_i=% (expect 2)', quarantined_i;
  END IF;
  RAISE NOTICE 'Block C complete: linked=%, quarantined quotes=%, quarantined invoices=%', linked_count, quarantined_q, quarantined_i;
END;
$$;

COMMIT;
