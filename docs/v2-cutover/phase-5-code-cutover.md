# Phase 5 — Code cutover

Goal: ship the V2 code to prod and clean up tracking files.

Prereq: Phase 4 complete, all DB work verified.

---

## Step 5a — Final dev → prod readiness check

```powershell
git fetch origin
git log origin/main..origin/dev --oneline   # what's about to merge
git status                                   # clean
```

Expected: the log shows the V2 commit set you expect. Working tree clean.

---

## Step 5b — Merge dev → main

```powershell
git checkout main
git pull origin main                          # confirm up-to-date
git merge --ff-only origin/dev                # fast-forward only
git push origin main
```

Expected: Vercel production build kicks off automatically. Watch the
build at vercel.com → project → Deployments.

If `--ff-only` fails: investigate. Either main moved (someone pushed)
or dev has merge-commits. Don't force; resolve manually.

---

## Step 5c — Watch Vercel prod build

Expected: build completes green in ~3-5 min. App available at prod URL.

If build fails: check the error. Common causes:
- Env var missing in prod (Supabase URL / publishable key)
- TypeScript compilation error that slipped past local check

---

## Step 5d — Clear pending migrations memory

Edit `~/.claude/projects/.../memory/project_pending_prod_migrations.md`:

- Empty the "Pending list" section (entries 1-45)
- Empty the "⚠ Migrations on disk NOT individually numbered below" block
- Keep the workflow rule paragraph at top + the "Why this file exists"
  footer
- Add a "Last cutover: 2026-MM-DD — all V2 migrations applied" line

This signals to future sessions: prod and dev are in sync.

---

## Step 5e — Update deployment memory if flow changed

If the cutover surfaced anything that should change the standing
deployment workflow, update `~/.claude/projects/.../memory/feedback_deployment.md`.

Otherwise leave alone.

---

## Step 5f — Re-enable Vercel auto-deploy (if you paused it in 0d)

Vercel → Settings → Git → re-enable.

---

## Phase 5 complete when

- [ ] 5b merge succeeded, main pushed
- [ ] 5c Vercel build green
- [ ] 5d pending list cleared
- [ ] 5e deployment memory verified current

Proceed to Phase 6.
