# Dev Environment Setup Runbook

Last updated: 2026-04-27

This document walks through setting up a separate development environment for Amplified AOS + amplified-staff that mirrors production, lets you test schema migrations and seed/data scripts safely, and is testable in the cloud (not just locally).

## Architecture overview

| Layer | Production | Development |
|---|---|---|
| Git branch (AOS) | `main` | `dev` |
| Git branch (staff) | `master` | `dev` |
| Supabase project | `amplified-aos` (existing) | `amplified-aos-dev` (new) |
| Vercel environment | Production | Preview |
| URL (AOS) | your prod custom domain | `amplified-aos-git-dev-<org>.vercel.app` |
| URL (staff) | your prod staff domain | `amplified-staff-git-dev-<org>.vercel.app` |

One repo, two branches. Vercel auto-builds a Preview deployment for any non-prod branch using a different set of environment variables, which is how each environment talks to its own DB.

## Prerequisites

- Local PostgreSQL client tools v15+ (`psql`, `pg_dump`). On Windows install via [PostgreSQL installers](https://www.postgresql.org/download/windows/) or use `winget install -e --id PostgreSQL.PostgreSQL.15`.
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase` or `scoop install supabase`).
- Access to Vercel project settings for both `Amplified-AOS` and `amplified-staff`.
- Owner-level access to the existing Supabase prod project.

## Step 1 — Create the dev Supabase project

1. Go to [Supabase dashboard](https://supabase.com/dashboard) → New Project.
2. Name: `amplified-aos-dev`. Region: **same region as prod** (latency from cloned data + Vercel functions).
3. Set a strong database password and save it in your password manager.
4. Wait for provisioning (~2 min).
5. Note these values from Project Settings:
   - **Project URL** (e.g. `https://abcd.supabase.co`)
   - **anon public key** (Settings → API)
   - **service_role secret key** (Settings → API; keep this safe, server-side only)
   - **Database connection string** (Settings → Database → Connection string → URI). Replace `[YOUR-PASSWORD]` with the one from step 3. Looks like `postgresql://postgres:<pwd>@db.abcd.supabase.co:5432/postgres`.

## Step 2 — Snapshot prod and restore to dev

You'll need both connection strings exported as environment variables. From your shell:

```bash
export PROD_DB_URL="postgresql://postgres:<pwd>@db.<prod-ref>.supabase.co:5432/postgres"
export DEV_DB_URL="postgresql://postgres:<pwd>@db.<dev-ref>.supabase.co:5432/postgres"
```

### 2a. Dump prod

```bash
pg_dump \
  --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  "$PROD_DB_URL" > prod-snapshot.sql
```

This produces a single SQL file with schema + data for the public, auth, and storage namespaces. Roughly 10–60 MB depending on volume.

### 2b. Restore to dev

```bash
psql "$DEV_DB_URL" < prod-snapshot.sql
```

You may see a small number of warnings about objects already existing (Supabase pre-creates some auth helpers). These are safe to ignore.

If the restore aborts, the most common cause is RLS policies referencing roles that don't exist on dev. Re-run with:

```bash
psql "$DEV_DB_URL" -v ON_ERROR_STOP=0 < prod-snapshot.sql
```

## Step 3 — Storage buckets (optional, do later if not urgent)

The `storage.objects` rows came across in the dump but the actual file binaries did not. Two options:

### 3a. Skip storage (recommended for first pass)
Most app screens still work. Job-request attachments and employee asset PDFs will return 404 in dev — fine for now.

### 3b. Mirror buckets with `rclone`
```bash
# One-time config — see rclone Supabase Storage docs
rclone copy supabase-prod:job-request-attachments supabase-dev:job-request-attachments --progress
rclone copy supabase-prod:employee-assets supabase-dev:employee-assets --progress
# repeat for each bucket
```

## Step 4 — (Skipped for now) PII sanitization

Not doing automated scrubbing — the data set is small and any concerns can be hand-corrected in the Supabase dashboard. If we ever need a scripted scrub (e.g. before sharing dev access more widely or sending dev test emails), add a `docs/dev-sanitization.sql` and re-introduce this step.

The one thing worth doing right after the clone, before exposing dev to anyone: in the Supabase dashboard, change the password on every `auth.users` row except the dev admin(s), so cloned prod credentials can't be used to log into dev.

## Step 5 — Set Vercel Preview environment variables

For **each** Vercel project (AOS and amplified-staff), go to Project Settings → Environment Variables.

Add these scoped to **Preview** only (leave Production untouched so prod keeps pointing at prod DB):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dev project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` (if used by API routes) | Dev service_role key |

Do **not** click "All environments" — that would overwrite prod.

If your codebase reads any other env vars (Stripe keys, Resend API keys, etc.), add Preview-scoped versions pointing at sandbox/test accounts.

## Step 6 — Create the `dev` branch on each repo

```bash
# Amplified-AOS
cd /c/amplified/Amplified-AOS
git checkout -b dev
git push -u origin dev

# amplified-staff
cd /c/amplified/amplified-staff
git checkout -b dev
git push -u origin dev
```

Vercel will auto-build a Preview deployment for each. Within 1–2 minutes you should see them at:

- `https://amplified-aos-git-dev-<your-org>.vercel.app`
- `https://amplified-staff-git-dev-<your-org>.vercel.app`

## Step 7 — Verify

1. Open the AOS dev URL and log in with your designated dev admin (whose email you preserved in step 4).
2. Spot-check that data is present (clients, quotes, employees) but PII is sanitized (emails are `dev+...@example.invalid`).
3. Make a trivial change on the `dev` branch (e.g. change the dashboard title), push, and watch Vercel rebuild the preview against dev DB.
4. Confirm prod URL still works and shows real prod data.

## Ongoing workflow

### Daily development

```bash
git checkout dev
git pull
# do work
git add ... && git commit -m "..."
git push  # auto-builds dev preview
```

### Database migrations

1. Author the SQL in `supabase/migrations/<date>_<name>.sql`.
2. Apply to **dev** first via `psql "$DEV_DB_URL" < supabase/migrations/<file>.sql` or Supabase SQL editor on the dev project.
3. Verify the migration on dev, including app behaviour.
4. Once happy, apply the same SQL to prod the same way.
5. Commit the migration file. (We track them in git but apply manually — keeps both DBs in sync without any auto-deploy surprises.)

### Releasing dev → prod

When dev work is verified:

```bash
git checkout main  # (or master for staff repo)
git merge dev
git push           # triggers prod deploy
```

Then merge `main` back into `dev` if there were any prod-only hotfixes:

```bash
git checkout dev
git merge main
git push
```

### Re-cloning prod → dev

Avoid this if possible — you'll wipe any in-flight dev work. When unavoidable (e.g. you need fresh prod data shapes for a complex migration test):

1. Drop dev tables: `psql "$DEV_DB_URL" -c "drop schema public cascade; create schema public;"`.
2. Re-run Step 2 (dump + restore).
3. Re-run Step 4 (sanitize).
4. Re-apply any migrations that landed on dev but not prod.

## Things to think about

- **Sensitive data on dev**: even sanitized, dev still has real client names, real employee names, real invoice amounts. Treat the dev URL as confidential — share with the team only, don't post in public channels.
- **Drift between dev and prod**: rigorous "dev first, then prod" migration discipline (Step "Ongoing workflow" above) prevents schema drift. The biggest risk is a hotfix on prod that doesn't get back-ported to dev — review the back-merge after every prod push.
- **Auth user reset cadence**: if multiple devs/testers create accounts on dev during testing, periodically truncate and re-seed.
- **Vercel paid plan**: Preview deployments work on all plans, but if you exceed Hobby limits (build minutes, bandwidth) Vercel will auto-pause. Monitor usage.
- **Email sending in dev**: if any feature sends real email (Resend, SMTP), ensure the Preview env points at a test sender account so dev never emails real clients. The sanitized `@example.invalid` addresses help here as a second line of defence.
- **Stripe / payments**: any payment integration should use test-mode keys on dev.

## Troubleshooting

**"Could not connect to dev DB" from Vercel preview build**
Check that the Preview-scoped env vars are exact (no trailing whitespace, correct anon key, URL ends with `.supabase.co` not `.supabase.in`).

**"role 'supabase_auth_admin' does not exist" during pg_dump restore**
Add `--no-owner --no-privileges` to the pg_dump command (already in Step 2). Don't try to dump the entire DB; stick to public/auth/storage schemas.

**Preview build succeeds but pages are blank with 401**
RLS policies on the dev DB are denying anon access. Check Supabase dashboard → Authentication → Policies for the dev project. The policies came across in the snapshot, but if they reference custom auth claims or roles, those may need re-creation.

**Vercel preview hits prod DB (oh no)**
Check the env vars again — Vercel evaluates scopes by exact match, and selecting "All environments" silently overrides scoped values. Production-scoped vars win on `main` deploys; Preview-scoped wins on all other branches.

## See also

- [Supabase docs: Database → Backups](https://supabase.com/docs/guides/platform/backups)
- [Vercel docs: Environment Variables](https://vercel.com/docs/projects/environment-variables)
- Project memory: `~/.claude/projects/.../memory/feedback_deployment.md` (existing prod-only deployment workflow — update once dev environment is live)
