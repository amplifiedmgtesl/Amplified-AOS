# Application Review — 2026-06-11

Full-app review (security, data integrity, financial correctness, code
quality, UX/performance) plus Supabase security advisors on dev + prod.
This file is the durable tracker — update **Status** as items are resolved.

Statuses: `OPEN` · `IN PROGRESS` · `RESOLVED <date> <how>` · `WONTFIX <why>`

---

## 1. Security

| # | Sev | Finding | Where | Status |
|---|-----|---------|-------|--------|
| S1 | HIGH | `SUPABASE_SERVICE_ROLE_KEY` committed to git in `.env.local` (commit `27f648a`); `.gitignore` doesn't exclude it. Anyone with repo access has god-mode on the DB, forever, via history. Fix: rotate key in Supabase dashboard, `git rm --cached .env.local`, add to `.gitignore`, optionally purge history. | `.env.local` | OPEN |
| S2 | HIGH | All ~34 tables have `USING (true)` RLS policies **with GRANTs to `anon`** — anyone holding the public anon key (it ships in every browser) can read/write everything without logging in. Minimal fix: one migration switching policies/GRANTs from `anon, authenticated` to `authenticated`-only. Confirmed by Supabase advisors (`rls_policy_always_true` on every business table, both envs). | all migrations | OPEN |
| S3 | HIGH | Storage buckets (`employee-assets`, `job-request-attachments`) are public and listable (`public_bucket_allows_listing`, both envs). Employee ID scans/certs downloadable anonymously. Fix: `public=false` + signed URLs in lib/storage helpers. | `lib/storage/*` | OPEN |
| S4 | HIGH | No server-side authorization anywhere: no `middleware.ts`; role gating is client-side only (AppShell + `useUserRole`). IT-only payroll recovery actions (`recomputeDailyRulesForRun`, `finalizePayrollRun`, `voidPayrollRun` in `lib/store/payroll.ts`) are plain client-side Supabase calls any user can invoke. Fix: API routes or RLS-based role checks. | `lib/store/payroll.ts`, app-wide | OPEN |
| S5 | MED | Leaked-password protection disabled in Supabase Auth (advisor `auth_leaked_password_protection`, both envs). One-toggle fix in dashboard. | Supabase Auth settings | OPEN |
| S6 | MED | `anon` can execute security-definer functions `is_admin` / `current_user_role` / `current_user_email` / `is_admin_only` / `rls_auto_enable` (advisor). | DB functions | OPEN |
| S7 | MED | File uploads: no size or MIME-type limits. | `lib/storage/employee-assets.ts`, `job-request-attachments.ts` | OPEN |
| S8 | LOW | ~20 functions with mutable `search_path` (advisor `function_search_path_mutable`). Low risk in this schema; batch-fix with `SET search_path = public`. | DB functions | OPEN |
| S9 | LOW | `/api/users/*` validates admin via manual Bearer-token parsing instead of `@supabase/ssr` session handling; works but non-idiomatic. Input validation is nullness-only (no zod). | `app/api/users/*` | OPEN |
| S10 | INFO | Backup tables `quotes_lines_backup` / `invoices_lines_backup` have RLS enabled with no policy (inaccessible — probably desired; advisors flag it). | DB | OPEN (likely WONTFIX) |
| S11 | HIGH | `notification_log` (added 2026-06-18 with the notifications module) inherits the **S2** open-RLS posture (anon-readable via the public key) but holds **PII**: recipient emails, phone numbers, message-body snippets, provider message IDs. More sensitive than most tables on that surface. Closed by the S2 `authenticated`-only fix; exposed until then. | `notification_log` | OPEN |
| S12 | MED | `backup_20260606_ccmf_entries_specialty_fix` has RLS **fully disabled** in `public` (advisor `rls_disabled_in_public`, **ERROR**) — unlike the other recovery tables (RLS-enabled-no-policy, locked, see S10), this one is genuinely anon-readable, exposing a copy of CCMF timesheet/specialty data. Fix: drop it (stale one-off backup) or `ENABLE ROW LEVEL SECURITY`. Broader cleanup: ~16 `backup_*` / `snapshot_*` recovery tables are dead clutter and the bulk of the perf advisor's `no_primary_key` noise — drop after confirming each is a true one-off. (The 4 `*_snapshot` *monitoring* tables are intentional — keep.) | DB | OPEN |

> **Re-verified 2026-06-18** (advisors + direct catalog queries, prod): S1–S10 all still **OPEN** — nothing resolved since the review. S1 worse than filed (`.env.local` still *tracked*, not just in history; key rotation unconfirmed). S2 confirmed at full scope: **all 52 public tables anon-readable AND anon-writable**, 34 `USING(true)` policies. S3 both buckets still `public=true`. S4 still no `middleware.ts`. New this date: S11, S12. Performance advisor reviewed — DB index hygiene (unused/unindexed) lives in `docs/technical-debt-backlog.md` (timesheet index revisit ~2026-06-23) + the monitoring snapshot job; `unused_index` counts are unreliable until ~a week of post-resize snapshot data accrues.

## 2. Data integrity

| # | Sev | Finding | Where | Status |
|---|-----|---------|-------|--------|
| D1 | CRIT | Employee-insert FK race (Brent incident 2026-06-11: 39/59 entries lost to 23503). Timekeeping inline-create now awaits; dead un-awaited `setEmployees` path removed; employee-directory create + CSV import now await and alert on failure. | `db.ts`, `timekeeping.tsx`, `employee-directory.tsx` | RESOLVED 2026-06-12 (this commit) |
| D2 | CRIT | `syncJobSheet` non-atomic delete-then-insert of workers. | `db.ts` | RESOLVED 2026-06-12 — function deleted with Job Sheets decommission (`3850b8f`) |
| D3 | HIGH | Fire-and-forget sync errors are silent for `setTerms`/`setClientName` (`syncRateState`) and several other paths — failed save logs to console only; refresh restores old data. Apply the `notifyTimesheetSaveError` pattern. | `db.ts:~276` | OPEN |
| D4 | HIGH | Draft-on-draft concurrent edits are last-write-wins (two tabs editing the same quote/invoice draft silently clobber). Freeze triggers protect issued docs only. Fix: `updated_at` conflict check on draft upserts. | `db.ts` upsert patterns | OPEN |
| D5 | MED | `overwriteFromTimesheets` delete→insert→back-link isn't atomic (transient orphan back-links mid-sequence). Consider RPC. | `lib/store/invoices.ts:~1077` | OPEN |
| D6 | MED | User-creation API: auth user created, then profile upsert failure still returns 201 (orphaned auth user). User-deletion: profile deleted before auth delete without error check. | `app/api/users/*` | OPEN |
| D7 | MED | `upsertInvoiceDraft` client-collision guard normalizes case on only one side of the comparison. | `db.ts:~352` | OPEN |
| D8 | MED | Unbounded `select("*")` in `initStore` on `timesheet_entries`, quotes, invoices, calendar_events (only employees paginates). Several tables also lack `.order()` → nondeterministic list order. | `db.ts:~138-156` | OPEN |
| D9 | LOW | `overwriteFromTimesheets` dry-run preview omits the invoice_days snapshot side effect that the real run performs. | `lib/store/invoices.ts` | OPEN |

## 3. Financial correctness

| # | Sev | Finding | Where | Status |
|---|-----|---------|-------|--------|
| F1 | MED | $0-rate lines can freeze into issued invoices: missing rate-card row → line created at $0 with only a `skipped[]` console warning. Recommended: pre-issue validation blocking `baseHourly === 0` lines (with explicit override). Related: 28 "Lead" + 27 "Other" master rows bill $0 (see position/specialty cleanup project). | `lib/store/invoices.ts:~890` | OPEN |
| F2 | LOW | Quote-preview OT/DT split hardcodes DT-at-15 (`computeDayHourSplit`); a rate card with DT at 12 shows hours 12–15 mislabeled as OT in the editor preview (display-only; billing math is correct). | `lib/rates/ot-trigger.ts:54` | OPEN |
| F3 | INFO | Deposit credit logic sums all active deposit invoices per job; safe only because a unique partial index enforces ≤1. Worth a runtime warning if >1 ever appears. | `lib/store/invoices.ts:~475` | OPEN |
| F4 | INFO | Wall-clock/browser-locale date handling assumes single-timezone deployment (documented assumption; revisit if multi-TZ). | `lib/time-utils.ts` | OPEN |

Reviewer notes (positive): rounding is consistent cent-rounding throughout; holiday 2× override correct; OT/DT threshold edge cases correct; overwrite-from-timesheets preserve logic is production-grade.

## 4. Code quality

| # | Sev | Finding | Where | Status |
|---|-----|---------|-------|--------|
| Q1 | MED | `timekeeping.tsx` ~2,000 lines doing picker+grid+approval+print; top refactor candidate. | `components/shared/timekeeping.tsx` | OPEN |
| Q2 | MED | `rowToQuoteLine`/`rowToInvoiceLine`/payroll line converters are near-identical triplicates; extract shared converter. | `lib/store/{quotes,invoices,payroll}.ts` | OPEN |
| Q3 | MED | ~550 uses of `any`; no generated Supabase types (the `generate_typescript_types` MCP tool is available). Highest-leverage type-safety win. | store + components | OPEN |
| Q4 | HIGH-ROI | Issue/Delete buttons in quote & invoice draft editors lack `disabled` during async mutation → double-click risk. Tiny fix. | `quote-draft-editor.tsx ~1100`, `invoice-draft-editor.tsx ~1314` | OPEN |
| Q5 | LOW | 26-useState cluster in `invoice-detail.tsx`; raw Supabase queries scattered in components; inconsistent alert()/confirm() patterns. | various | OPEN |

## 5. UX / performance

| # | Sev | Finding | Where | Status |
|---|-----|---------|-------|--------|
| U1 | HIGH | No `beforeunload` guard on quote/invoice draft editors — autosave debounce is 800ms, so navigating away right after typing silently loses the last edit. | both draft editors | OPEN |
| U2 | MED | Autosave failure feedback is a muted "Saving…" label; failures should be loud (toast/banner + keep Save enabled). | both draft editors | OPEN |
| U3 | MED | Lists (quotes, invoices, payroll) fetch entire tables, no pagination/virtualization; fine now, degrades with growth. | `*-list.tsx` | OPEN |
| U4 | LOW | Date display mixes browser-locale `toLocaleDateString()` and ISO; standardize. | various | OPEN |
| U5 | LOW | `alert()`/`confirm()` everywhere instead of a toast/modal system; duplicate CSS rule block in `globals.css` (~136-144). | app-wide | OPEN |

## Resolved during/just after the review

- Job Sheets decommission (`3850b8f`): legacy data linked to jobs in prod (SQL in `docs/data-integrity/legacy-jobsheet-timesheet-linking/`), screens/write-paths removed, D2 closed. 4 Spring Concert entries left `submitted` for Connor's triage.
- Crew-leader Jobs page (`f87eb2f`): `/lead/jobs` with billing config hidden; dollar-amount gating verified on all three lead screens.
- D1 Brent FK race closed (this commit).
