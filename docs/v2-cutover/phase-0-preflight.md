# Phase 0 — Pre-flight

Goal: snapshot prod, size every known risk, decide if anything needs
attention BEFORE the cutover starts.

---

## Step 0a — Snapshot prod

Why: rollback safety net.

In the Supabase dashboard → project `wmssllfmahotppoyxxrr` → Database → Backups
→ confirm last automated backup timestamp. If > 6 hours old, trigger a
point-in-time backup.

Expected: backup timestamp within last 6 hours, visible in the Backups list.

---

## Step 0b — Prod pre-flight audit

Why: read-only sizing of every known risk against actual prod data.

Open prod Supabase SQL Editor. Paste `docs/data-integrity/00_prod_preflight_audit.sql`.
Run.

Expected output to capture:
- Section 2: only `quoted` and `signed` statuses on quotes
- Section 3a + 3b: duplicate invoice rows (may be 0; if not, see below)
- Section 4: auto_linked + weak_match + unmatched sum to total_timesheets
- Section 5: all 9 duplicate-cluster rows present with expected shape
- Section 7: position text distribution (Crew + Fork Op dominant)

If Section 3 returns rows:
- Each row needs a supersede decision before migration #23 (`20260506b`)
- Pattern: keep the one representing real billing reality (paid > sent partial > sent unpaid)
- For each conflict group, mark all but one as `superseded`:
```sql
UPDATE invoices SET status = 'superseded' WHERE id IN ('invoice-id-1','invoice-id-2', ...);
```
- Document the decisions in the cutover log

If Section 4 shows large unmatched count:
- Memory #31 expected ~20% unmatched (legacy / NULL is acceptable)
- If unmatched > 40%, investigate client-name drift before applying #31

If Section 5 disagrees with memory shape by > ±2 on any row:
- The cluster shape changed since memory was written — re-read
  `project_pending_prod_migrations.md` entries #2 + #32 and update the
  merge scripts (`07_*` through `10_*`) if assumed IDs no longer apply

If Section 7 shows position text values other than `Crew`, `Fork Op`,
or canonical names:
- Add the new text values to `data-integrity/...` cleanup #38 SQL
  (the UPDATE block) before running it

---

## Step 0c — Confirm dev parity

Why: sanity-check that nothing was committed to dev but not pushed up,
or applied to dev but not committed.

```powershell
git status                                    # working tree clean
git log dev..phase1-timekeeping-jobid --oneline   # nothing local-only
git log origin/dev..dev --oneline             # nothing pushed-only
```

Expected: all three return empty / clean.

---

## Step 0d — Lock cutover window

Why: prevent in-flight admin writes from racing the migrations.

Notify Connor + admins that prod is locked from `<start>` to `<end>`
(suggest 3-hour window). No quote/invoice creation, no employee edits,
no timesheet submissions during the window.

Optional: pause Vercel prod deployments temporarily (Settings → Git
→ Disable for V2 cutover) so a stray commit doesn't ship code before
Phase 2 migrations are applied.
