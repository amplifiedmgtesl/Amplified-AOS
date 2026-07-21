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

## 5. Verify on prod

- The version under the Sign out button shows the new number.
- The /changelog page's top entry matches it and describes what just shipped.

## Why entries are written at promotion time

The /changelog page renders the CHANGELOG.md **baked into the deployed
build** — prod can only show what shipped with it. Writing entries when work
merely lands on dev risks a wholesale merge later carrying stale or premature
entries. The rule: dev-parked work has no entry; the entry is finalized in the
same breath as the merge.
