-- Deposit percentage on quotes. Legacy quote-builder stored only the $ amount,
-- which loses intent: a 50% deposit on $10k is $5k, but if more lines push
-- the subtotal to $12k, the stored $5k is now 41.7% — not 50% anymore.
--
-- Storing the percentage explicitly lets the deposit $ recompute on every
-- subtotal change while preserving the user's original intent.
--
-- Backfill: derive pct from existing deposit / total. NULL where total is 0.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_pct numeric;

UPDATE quotes
   SET deposit_pct = ROUND((deposit / NULLIF(total, 0)) * 100)
 WHERE deposit_pct IS NULL
   AND total IS NOT NULL
   AND total > 0;
