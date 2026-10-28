# Onboarding changes from Connor's use — review (2026-10-27)

Branch `feature/onboarding-filters`, off `main` (v2.14.0). Prod hotfix path: ship to prod, then merge back into `dev`.
Built unattended: committed locally only. Not pushed, not merged, no migration applied anywhere.

## What's built

| # | Ask | Status |
|---|-----|--------|
| 1 | One list instead of "on jobs" / "not on jobs" | Built |
| 2 | Filters at the top (+ Paychex filter on Employees) | Built |
| 3 | Reminder email to finish the application / Paychex | **Held**: no email sender yet (Resend needs amplifiedesl.com DNS, which is in Wix) |
| 4 | Which Paychex onboarding steps are still outstanding | **Held**: needs research into what the Paychex API shows for an in-progress worker |
| 5 | Export the filtered list to CSV | Built |
| 6 | Per-user Onboarding access | Built (migration `20261027a`) |

## Judgement calls (approve or overturn)

1. **Order of the one list:** people on a job first, oldest pay owed on top (as before), then applicants, newest first. No column sorting.
2. **Filters chosen:** Search · Job (Everyone / On a job / Not on a job) · When (Any / last 7 / 14 / 30 days / Booked ahead) · Missing info (Any / email or phone / no email / no phone / has both) · Paychex (Any / Not sent / Sent, waiting / Possible match in Paychex / Not in Paychex). "When" uses the last day worked, or the application date for people not on a job. "Booked ahead" = has a future confirmed crew day.
3. **Filters reset when the page reloads.** They aren't remembered.
4. **Send selected only sends people the filters show.** A person who was ticked and is then hidden by a filter is not sent, and the count shows visible ticks only. Select-all ticks everyone shown who can be sent. Before, each section had its own select-all box.
5. **Paychex "found / not found" filters** show nobody until the Paychex check finishes on page open, a second or two.
6. **CSV columns:** Name, Type, Email, Phone, Missing, On a job, First worked, Last worked, Job, Hours, Next booked, Next job, Applied, Applied for, Paychex, Possible duplicate. No Payroll ID column, since nobody on this list has one. File name: `Onboarding — YYYY-MM-DD.csv`. It has a byte-order mark so Excel reads accents correctly.
7. **Per-user access = `profiles.can_onboard`.** It's a checkbox under Role in Maintenance → Users. It's ticked and greyed out for admins (they always have it) and greyed out for crew leaders, whose /lead app has no Onboarding screen. The user list shows a "+ Onboarding" badge.
8. **Ticked users get every Onboarding tool except Merge.** Merge deletes a record, and the database function `merge_employee` still refuses non-admins, so the button is hidden for them. They can edit email/phone, switch W-2/1099, **Not same**, **Use ID**, **Send to Paychex** and **Update from Paychex**. The Paychex update route (`/api/paychex/snapshot` POST) now also accepts ticked users, since Onboarding calls it.
9. **Profile reads use `select("*")`** in the app shell and the API check. A not-yet-migrated database then doesn't break anyone's login. Even so, apply `20261027a` **before** deploying: editing a user sends `can_onboard` and would fail on a database that doesn't have the column.
10. **Employees screen Paychex filter:** Everyone / Has Payroll ID / Sent, waiting / No Payroll ID, not sent.
11. **Version 2.15.0** (minor: new features). The changelog entry is drafted and gets re-checked at promotion.

## Checked

- Typecheck clean. 285 tests pass, 9 of them new: `tests/store/onboarding-filters.test.ts`. `next build` succeeds.
- **Not browser-tested.** That needs the migration on dev plus a login. To do before prod: apply `20261027a` to dev, push the branch, and click through on its preview: filters, CSV, the checkbox, and logging in as a ticked coordinator.

## Rollout steps (when John says go)

1. Apply `supabase/migrations/20261027a_onboarding_access.sql` to dev. Push the branch and test on the preview.
2. Apply it to prod, then push the branch to `main` and verify `/api/version`.
3. Merge `main` back into `dev`, together with the Help changes below.

## Help text to add on the merge back into dev (HELP.md lives on dev only)

- **Onboarding, "Who:"** → "Admins, and anyone with **Onboarding** ticked on their user (Maintenance → Users). Only admins can **Merge**."
- **Onboarding, first paragraph:** add "Website applicants from the last 30 days with no Payroll ID are in the same list, after the people on a job."
- **New bullet, "Filters":** Search, **Job**, **When**, **Missing info**, **Paychex** (meanings as in judgement call 2). **Clear filters** resets them. **Send selected** and the top box only cover the people shown.
- **New bullet, "Export CSV":** downloads the people shown, for the coordinators.
- **Remove** the "Applicants · no job yet" bullet. Change "the top box ticks everyone who can be sent" to "… everyone shown who can be sent".
- **Users, step 3:** add "Tick **Onboarding** to give a coordinator or payroll user the Onboarding screen."
- **Employees, "Finding someone":** add **Paychex** to the list of filters.

## Found along the way (not fixed)

- **`profiles` RLS is wide open** (`profiles_full_access`: `ALL` to anon + authenticated, `true`, verified on dev 10/27). Any signed-in user can change their own `role` to admin from the browser. The same goes for the new `can_onboard`. This predates this branch and needs its own fix.
