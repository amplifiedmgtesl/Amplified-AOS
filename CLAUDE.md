# Amplified AOS — working notes for Claude

## Tests

```bash
npm test          # vitest run — ~1s
npm run test:watch
```

**Run the suite before proposing any promotion to prod.** It is in
`docs/promote-to-prod-checklist.md` as step 2 and it is not optional.

**Write tests as part of the change, not afterwards.** If you add or alter a
pure calculation — money math, hour splits, rate derivation, date helpers —
it gets a test in the same change. `tests/README.md` holds the scope rule:
**pure functions only, no database, no mocks, no jsdom.** Keep it that way;
the value of this suite is that it stays fast and fixture-free.

**Be honest about what green means.** The suite covers arithmetic. It says
nothing about DB triggers, RLS, PostgREST behaviour, or anything needing a
round trip. On 2026-08-30 the payroll void path turned out to have been
broken since it was written — two triggers colliding, zero runs ever
voided — and a fully green suite had nothing to say about it. Do not report a
green run as evidence a feature works; say what was actually exercised.

## Promotion to prod

Follow `docs/promote-to-prod-checklist.md` in full, every time, including
one-line fixes. Every promotion bumps `package.json` and adds a CHANGELOG
entry written for Connor in plain English — not for developers.

`dev` runs well ahead of `main` with unrelated pending work. **Never merge
`dev` wholesale into `main`.** Branch a fix off `origin/main`, push that
branch to `main`, then merge the same branch back into `dev`.

Pushing to `dev` or `main` needs explicit authorization from John in the
conversation. Feature branches are fine to push unasked.

## Verifying a prod deploy

`https://amplified-aos.vercel.app/api/version` returns the deployed SHA.
Check it rather than assuming the build succeeded — a local `next build`
fails without `SUPABASE_SERVICE_ROLE_KEY`, so a clean typecheck is usually
the strongest local signal you have.

## Gotchas that have actually bitten

- **`.gitignore` has `node_modules/` with a trailing slash**, which matches a
  directory but *not* a symlink of the same name. If you symlink
  `node_modules` into a git worktree to run `tsc`, `git add -A` will commit
  the symlink. Stage specific files instead, or delete the link first.
- **Worktrees:** the main checkout usually sits on `dev` with uncommitted
  work. Use `git worktree add` for anything based on `main`; do not
  `git checkout` across a dirty tree.
- **Bash `cwd` resets between tool calls.** Use absolute paths or
  `git -C <repo>`.

## Databases

Supabase project refs — **prod `wmssllfmahotppoyxxrr`**, dev
`ovtbvnfhteqxnyirzctt`. Read-only queries against prod are how most
questions get answered. Writes to prod are John's to make: prepare the SQL
and hand it over rather than running it.

⚠ `Amplified-AOS/.env.local` points at **prod**, so a local `npm run dev`
writes to live data. The team tests on Vercel previews instead.
