# 2026-06-18 — Production disk-IO exhaustion outage

**Severity:** full outage (both apps, all users could not log in)
**Duration:** ~4 h of escalating degradation → full unavailability until compute resize
**Project:** `amplified-aos` (prod, ref `wmssllfmahotppoyxxrr`), AWS us-east-2, Pro plan

## Summary

Both front-ends (`amplified-staff` and `amplified-aos` on Vercel) could render the
login screen but could not log in. Root cause was **disk-IO budget exhaustion** on
the prod Postgres instance — *not* a billing/quota cap, storage limit, or paused
project. The instance was on the **Nano** compute tier (a leftover from the original
Free→Pro upgrade; Nano is billed at the Micro rate on paid plans but is never
auto-upgraded). A write-heavy timekeeping save pattern drained the tier's small
disk-IO burst budget; once depleted, IO throttled to baseline, every query crawled
past the statement timeout, and DB-backed auth started returning 522/504.

## Impact

- Login screen (static Vercel asset) rendered fine, masking the failure as "site won't log in."
- All authenticated traffic failed: `POST /auth/v1/token` returned **522** (origin unreachable) / **504** (gateway timeout).
- No data loss or corruption — this was an availability/load event.

## Detection

- User reported login failures on both apps.
- Supabase dashboard banner: *"Your project is currently exhausting multiple resources, and its performance is affected."*
- Project card: **"Project is depleting its Disk IO Budget."**

## Root cause (two layers)

**1. Undersized compute (the proximate cause).**
Prod ran on **Nano** (~0.5 GB RAM, tiny disk-IO ceiling). Nano/Micro use AWS gp3 volumes
with a baseline IOPS/throughput plus a *burst budget*; the effective IO ceiling is
capped by the compute tier well below the gp3 baseline. Sustained write IO drained the
burst budget; at baseline, even internal `pg_settings` lookups took 10–18 s.

**2. Write-amplifying save path (the real driver).**
The database is only **27 MB** with a **98% cache hit ratio**, so reads were served from
RAM — the budget was drained by **write IO (WAL)**, not reads. The dominant writer:

| Statement | Calls | WAL (disk writes) | WAL/call |
|---|---|---|---|
| `INSERT timesheet_entries` (v1) | 2,166 | 511 MB | 247 KB |
| `INSERT timesheet_entries` (v2) | 2,089 | 250 MB | 125 KB |
| `INSERT timesheet_entries` (v3) | 4,872 | 154 MB | 33 KB |
| `INSERT timesheet_entries` (v4/v5) | 661 | 28 MB | — |
| `INSERT quote_draft_workspaces` | 4,311 | 47 MB | — |
| `INSERT invoices` | 3,831 | 31 MB | — |
| `INSERT invoice_lines` | 2,534 | 28 MB | — |

`timesheet_entries` upserts generated **~940 MB of WAL** on a 27 MB database. 247 KB of
WAL for a single-row upsert is write amplification: the save path rewrites the row, and
each rewrite maintains all of the table's indexes (8 of them) plus full-page-image WAL
after each checkpoint.

**Code:** [`syncTimesheet`](../../lib/store/db.ts) ([db.ts:706](../../lib/store/db.ts)) upserts the
**entire set** of AOS-managed rows on **every edit**:
```ts
const aosManagedRows = t.rows.filter((r) => !r.userId);   // ALL rows, not just changed
supabase.from("timesheet_entries").upsert(entryRows, { onConflict: "id" });
```
The comment at [db.ts:748](../../lib/store/db.ts) confirms cadence: *"the entries upsert
re-fires on every edit."* The per-line **employee picker** is the edit trigger — picking
an employee on a line re-upserts every row on the sheet. A prior redesign moved this off
delete+reinsert to upsert, but it still writes *every row on every edit*.

Corroborated three ways: code, `pg_stat_statements` (WAL), and the performance advisor
(flags `timesheet_entries` with 3 unindexed FKs + several possibly-unused indexes).

## Remediation

**Immediate (service restored):**
- Resized prod compute **Nano → Micro** ($0 extra — Nano was already billed at the Micro
  rate). Resize restarts the instance; service returned in a few minutes.

**Corrective — observability (so a repeat is diagnosable in minutes):**
The diagnosis was hard because Postgres logs showed `canceling statement due to statement
timeout` **with no query text**, and per-table/index stat counters reset at the resize.
Enabled on prod, on **both** `authenticator` (the role PostgREST logs in as) and `postgres`,
via `ALTER ROLE … SET` (the `postgres` role is not a superuser on managed Supabase, so
`ALTER DATABASE` is denied; `supautils` permits these only via `ALTER ROLE`):

| GUC | Value | Purpose |
|---|---|---|
| `log_min_duration_statement` | `1500` | log slow queries **with SQL text** before the timeout |
| `track_io_timing` | `on` | real per-query disk read/write time in `pg_stat_statements` |
| `auto_explain.log_min_duration` | `3000` | auto-log plans+buffers for slow queries |
| `log_temp_files` | `0` | log any sort/hash spill to disk |

Plus a **snapshot job** (`monitoring` schema, internal-only, RLS-on/no-policies, pg_cron
`monitoring-capture-15m` every 15 min) capturing `pg_stat_statements` + per-table/index
usage + health into history tables (14-day retention; 90 for health). This gives trends
that survive restarts and makes "unused index" a reliable multi-day signal. Built on dev
via migrations `add_monitoring_snapshots` + `fix_monitoring_capture_io_columns`; applied to
prod via SQL Editor (the prod MCP connection is read-only).

**Pending — the real fix (prevents recurrence regardless of compute size):**
- **`syncTimesheet`**: upsert only *changed* rows + debounce the per-edit autosave. Cuts the
  number of row-writes ~30× on a typical sheet. See the technical-debt backlog entry
  "Timekeeping save path — upsert-all-rows-on-every-edit (write/WAL amplification)."
- **Index cleanup**: after ~a week of snapshot data, drop the `timesheet_entries` indexes
  that stay truly unused (less index maintenance → less WAL per write). See backlog entry
  "Revisit `timesheet_entries` index cleanup."

## Follow-ups / notes

- `authenticator` carries `statement_timeout=8s` — why app queries were cancelled so fast.
- `track_activity_query_size` is `1024` (truncates live queries mid-incident). Raise to
  `8192` at the next planned restart (needs restart — not worth downtime alone).
- Supabase retains these logs only **24 h** — consider a Log Drain for longer retention/alerting.
- Watch **Dashboard → Reports → "Disk IO % consumed"**: sustained >1% = dipping into burst
  budget; 100% = the outage condition. Micro still bursts (only 4XL+ is consistent IO), so
  the durable fix is the save-path change, not bigger compute.
- Adding the 3 missing FK indexes is **not** a fix here: the table is 1,863 rows (seq scans
  are sub-ms and cached), and new indexes *increase* write amplification on the exact hot path.
