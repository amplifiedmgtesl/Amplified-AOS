# Promote-to-Prod Checklist

Every promotion to `main`, no matter how small, follows these steps in order.
Established with John 2026-07-21 alongside the change log feature.

## 1. Confirm exactly what's shipping

- Diff `dev` against `main` (`git log origin/main..origin/dev --oneline`).
- If anything on dev is being **held back**, it must be cherry-picked around,
  not merged — and it gets NO changelog entry yet.

## 2. Finalize CHANGELOG.md

- The entry must describe **exactly** what's crossing to `main` — nothing
  that's staying parked on dev.
- Written for Connor, not developers: plain English, what it means for the
  person using the app.
- Dated heading carries the new version: `### July 21 — v2.1.0`.
- Entries for held-back work get pulled from the entry before merging.

## 3. Bump the version in package.json

John's convention (semver):

| Position | When | Example |
|---|---|---|
| First (major) | Fundamental overhauls (V2-cutover scale) | 2.x.x → 3.0.0 |
| Second (minor) | New features / meaningful changes | 2.1.x → 2.2.0 |
| Third (patch) | Small fixes and tweaks | 2.1.0 → 2.1.1 |

Every promotion bumps something. The on-screen version under the Sign out
button is the tie-back to the changelog heading — that only works if the
number always moves.

## 4. Merge and migrate

- Merge to `main` (user-authorized push).
- Apply any pending SQL migrations to the **prod** Supabase (user-driven —
  see `docs/dev-environment-setup.md` and the dev-workflow notes; prod does
  not auto-receive dev's migrations).

### ⚠ Vercel duplicate-commit gotcha

If the promotion was pushed as a **branch first** (e.g. `release/vX.Y.Z`) and
then fast-forwarded to `main` at the same SHA, Vercel **skips the production
build** as a duplicate — prod silently stays on the old commit (bit us
2026-06-11 and again 2026-07-21). Check `https://amplified-aos.vercel.app/api/version`;
if it still shows the old SHA a few minutes after the push, push an empty
trigger commit to `main`:

```
git commit --allow-empty -m "chore: trigger production deploy of <sha>"
```

## 5. Verify on prod

- The version under the Sign out button shows the new number.
- The /changelog page's top entry matches it and describes what just shipped.

## 6. Sync `dev` back up to `main`

Merge `main` into `dev` immediately after the promotion, so the two agree on
`CHANGELOG.md` and `package.json`.

```
git checkout dev && git merge main
```

**Why this step exists.** When a promotion is made by merging a feature branch
straight to `main` — which is the normal path for anything that has to ship
independently of work parked on `dev` — the changelog entry and version bump
land on `main` only. Nothing carries them back. `dev` then reports an older
version than production and its changelog is missing the entries that shipped.

Skipped after v2.2.0, v2.2.1 and v2.2.2; caught 2026-08-04, when `dev` was
still declaring v2.1.1 with a changelog stopping at July 21. Two costs when it
drifts: the dev preview lies about which version it is, and the next
`dev`→`main` merge tries to *delete* shipped changelog entries from prod,
which surfaces as a conflict someone has to resolve correctly under pressure.

Verify with `git diff main dev -- CHANGELOG.md package.json` — it should come
back empty. Anything else in a `main`-vs-`dev` diff is genuine parked work.

## Why entries are written at promotion time

The /changelog page renders the CHANGELOG.md **baked into the deployed
build** — prod can only show what shipped with it. Writing entries when work
merely lands on dev risks a wholesale merge later carrying stale or premature
entries. The rule: dev-parked work has no entry; the entry is finalized in the
same breath as the merge.
