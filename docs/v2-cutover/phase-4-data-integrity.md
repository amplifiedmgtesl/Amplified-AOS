# Phase 4 — Data-integrity playbook

Goal: bring stored aggregates into sync with computed truth + surface
any frozen-document anomalies for later Connor review.

Prereq: Phase 3 complete.

---

## Step 4a — Size the problem (drafts)

```sql
-- Paste contents of: docs/data-integrity/01_audit_drafts.sql
```

Expected: 7 sections of counts. Most should be 0 or low.

Snapshot the output — you'll compare against the post-fix re-run.

---

## Step 4b — Apply draft fixes

```sql
-- Paste contents of: docs/data-integrity/02_fix_drafts.sql
```

Expected: BEGIN/COMMIT completes. NOTICE lines reporting rows
updated per section.

---

## Step 4c — Verify drafts clean

Re-run Step 4a (`01_audit_drafts.sql`).

Expected: every count = 0.

If any count > 0: investigate before proceeding. Likely a row shape
unexpected — paste back here.

---

## Step 4d — Frozen audit (defer decisions)

```sql
-- Paste contents of: docs/data-integrity/03_audit_frozen.sql
```

Expected: per-row list. Save output to a file (cutover-log/frozen-audit.txt).

Default disposition per row: **leave alone**. The original PDF the
customer received stands as the historical billing record. The only
rows worth actively revising are ones where:
- The stored amount no longer matches what was billed AND
- The discrepancy affects current collections / accounting

Connor will walk the worksheet later. The audit does NOT block cutover.

---

## Step 4e — Deposit audit (defer decisions on Checks 2, 2b, 3)

```sql
-- Paste contents of: docs/data-integrity/04_audit_deposits.sql
```

Expected: 3 checks. Save Check 2, 2b, 3 output to a file.

Check 1 (stray lines on deposits) is auto-cleaned by the next step.

---

## Step 4f — Auto-clean deposit stray lines

```sql
-- Paste contents of: docs/data-integrity/05_fix_deposit_stray_lines.sql
```

Expected: NOTICE on rows deleted. Safe (deletes only where lines_sum ==
subtotal, so no displayed value changes).

---

## Step 4g — Verify deposit Check 1 clean

Re-run Step 4e (just Check 1 portion of `04_audit_deposits.sql`).

Expected: Check 1 returns 0 rows.

Checks 2, 2b, 3 may still have rows — those are Connor's later review.

---

## Phase 4 complete when

- [ ] 4a baseline captured
- [ ] 4b applied
- [ ] 4c every count = 0
- [ ] 4d frozen audit output saved for Connor
- [ ] 4e deposit audit output saved for Connor (Checks 2, 2b, 3)
- [ ] 4f stray-line cleanup applied
- [ ] 4g Check 1 returns 0 rows

Proceed to Phase 5.
