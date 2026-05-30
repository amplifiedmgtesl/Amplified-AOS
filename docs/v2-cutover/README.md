# V2 cutover playbook

Step-by-step files for the V2 production cutover. Walk through them in
order. Each file is self-contained — open, execute, mark off, next.

## Order

1. **[phase-0-preflight.md](phase-0-preflight.md)** — Prod snapshot + audit queries
2. **[phase-1-data-cleanup-pre.md](phase-1-data-cleanup-pre.md)** — Cleanups that must run BEFORE the schema migrations
3. **[phase-2-schema-migrations.md](phase-2-schema-migrations.md)** — All 50 schema migrations, 6 groups, exact apply order
4. **[phase-3-data-cleanup-post.md](phase-3-data-cleanup-post.md)** — Post-migration cleanups + 4 duplicate-job merge scripts
5. **[phase-4-data-integrity.md](phase-4-data-integrity.md)** — 7-script audit/fix playbook (drafts + frozen + deposits)
6. **[phase-5-code-cutover.md](phase-5-code-cutover.md)** — Merge dev → main, update memory, clear pending list
7. **[phase-6-smoke.md](phase-6-smoke.md)** — Post-cutover smoke checklist

## How each file is structured

```
## Step N — short title

Why: one line
Prereq: previous step done

[code/SQL block]

Expected: what success looks like
If not expected: what to do
```

## Workflow conventions

- **Prod SQL Editor only** for paste-and-run blocks (Supabase dashboard → SQL Editor → wmssllfmahotppoyxxrr)
- **All schema migrations** live in `supabase/migrations/`
- **All data cleanups** live in `docs/data-integrity/` (idempotent, RAISE EXCEPTION on mismatch, BEGIN/COMMIT wrappers)
- **Snapshot prod first** — never skip Phase 0 step 0a
- **Read Expected before Run** — if your eyes can pre-verify against the SQL, do so

## Abort criteria

Stop and investigate if any of these:
- A migration errors with anything other than the documented expected output
- A data-integrity script's pre-flight RAISE EXCEPTION fires
- Section 5 of `00_prod_preflight_audit.sql` doesn't match memory shape ±2
- A re-run of an audit shows non-zero where it should be zero

## After cutover

- Clear `project_pending_prod_migrations.md` to empty state
- Update `feedback_deployment.md` if the flow changed
- Spawn separate sessions for any deferred follow-ups from Phase 4d/4e
