# Amplified AOS — Change Log

What changed and when. Newest entries at the top.

## July 2026

### July 24 — v2.2.2
- Fixed: crew leaders on a phone had no navigation menu. The recent phone-usability update turned the side menu into a slide-in drawer opened by a ☰ button, but that button was missing from the crew-leader view — so the Jobs / Timekeeping / Employees menu was off-screen with no way to open it. The ☰ menu button is now back at the top of every crew-leader screen.

### July 22 — v2.2.1
- The Pre-Invoice Summary is now limited to admin roles, the same as Quotes and Invoices — coordinators, crew leaders, and payroll can no longer open it (the button was already hidden for them; this also blocks the direct link).

### July 22 — v2.2.0
- New Pre-Invoice Summary: from a job, open a client-ready PDF that previews what the invoice will charge — before you generate the actual invoice, so you have something to hand a client on-site for review. Crew is grouped by position, specialty, and matching shift times (everyone who worked the same hours lands on one line), with a separate page for each day and an estimated total. It's priced straight from the rate card, so the numbers match the eventual invoice. Reach it from the new "Pre-Invoice Report" button on a job. Any line missing a rate shows "Rate TBD" so it's easy to catch before sending.
- Printed documents (quotes, invoices, reports) no longer show the app's on-screen status banners at the top of the page.

### July 21 — v2.1.1
- Coordinators can now sign in. The login screen used to reject the Coordinator role outright — which is why coordinator accounts were set to Crew Leader as a workaround. Those accounts can now be switched back to Coordinator (Maintenance → User Management) to get the new scheduling-focused access; they land on the Jobs screen after signing in.

### July 21 — v2.1.0
- Added this change log page, reachable from the version number at the bottom of the sidebar.
- Coordinator accounts are now locked out of all money and admin screens: Quotes, Invoices, Rate Card, Job Costing, Payroll, Maintenance, and the Dashboard. They keep Calendar, Clients, Jobs, Timekeeping, Timesheet Review, and Employees — with billing amounts and pay rates hidden on those screens too.

### July 20
- Payroll users can now view the Jobs screen (read-only — no billing or quote access).
- Jobs list has a new calendar view toggle alongside the regular list.

### July 18
- Crew roster export: the Employees tab now only includes workers within 100 miles of the venue, so the pick-list isn't cluttered with out-of-area crew.
- Quote PDF: the rate schedule appendix is now off by default, with a checkbox on the preview to include it when needed.

### July 10
- Payroll can now be exported as a Rippling-ready CSV — one row per employee with hours split by earning type and workweek.
- Position Maintenance now includes the Rippling earning-type mapping for each position and specialty, editable on screen.
- Rate card pay rates were seeded from the Rippling flat rates.

### July 8
- Company settings now hold ACH/wire banking details, and invoices show a remit-to block with that information.

### July 5
- Mobile support: the app now renders properly on phones — the sidebar becomes a slide-out drawer with a hamburger button, and wide tables scroll instead of shrinking the page.

### July 2
- Fixed invoices failing to save when built from a quote (a database column removed in May was still being referenced). This was the "invoice won't save / wrong rates" issue.
- Timekeeping now loads entries for the selected job directly from the database instead of a capped cache — fixes missing records and duplicates on large jobs.
- Deleting a timesheet entry now actually deletes it (previously some deletes silently didn't stick).

## June 2026

### June 12–17
- Crew roster spreadsheet export and import: build the roster in Excel and import it back, with duplicate-name protection and contact-update confirmation.
- Jobs, Employees, and Clients screens converted to a browse-list → detail-page flow.
- Legacy Job Sheets were fully retired (the data is kept as history).
- Crew leader portal gained a Jobs page (no dollar amounts visible).
- The app now shows a banner when a new version has been deployed, with a one-click refresh.
- Fixed timesheet rows vanishing when adding a brand-new employee and entries in quick succession.
- Manually corrected invoice lines are now preserved when re-pulling labor actuals from timesheets.
- New notifications module for email and SMS (infrastructure — not yet user-facing).
- Added a printable timekeeping guide for crew leads and admins.

### June 6–7
- Fixed duplicate deposit invoices when re-generating from a revised quote.
- Rate cards support per-role overtime/doubletime thresholds, carried through to timesheets.
- Final invoices can now be generated per-day, with guardrails so per-day and whole-job finals can't overlap.
- New Job Health Check tab on the Jobs screen — flags missing shifts, unapproved time, unbilled days, and blocks invoicing on real problems.
- Invoice editor shows a daily breakdown of the timesheet hours behind each pull.

### June 1–3
- New payroll-only user role for the payroll service.
- First version of the Rippling CSV export.
- Timekeeping: shift picker on each entry, with approval gated on a shift being set.
- Timekeeping: "duplicate previous day" and "copy to new day" buttons to speed up repeat entry.
- Payroll: adjustment reasons now show when hovering over adjusted hour cells.
- Warning shown on jobs that have no shifts defined.
- Loading overlays added across timekeeping and dashboard so slow loads are obvious instead of looking frozen.

## May 2026

### May 30 — v2.0.0 · The V2 cutover
- The rebuilt quotes and invoices system went live in production: quote drafts with revisions, deposit and final invoices, explicit line-item math, and job-linked timekeeping. Legacy quote and invoice builders were retired.
- Performance pass on timekeeping for large jobs.

### May 25–31
- Payroll module: create paydate runs from approved timesheets, editable pay rates, printable payroll report.
- Connor's payroll rules built in: 5-hour daily minimum, round-up, and weekly overtime — applied per employee per day with a review button.
- Holiday pay: days can be flagged as holidays, billed and paid at the rate card's holiday multiplier, flowing through quotes, invoices, timekeeping, and payroll.
- Timekeeping: bulk select with batch approve/reject; approved entries are frozen against edits.
- Bill rates on timesheets renamed and separated from pay rates to end the bill-vs-pay confusion.

### May 9–13
- Invoice rewrite: new invoice list and draft editor, deposit invoices, printable invoice PDF, and timesheet-to-invoice-line tracking.
- Line items moved to an explicit ST/OT/DT hours + crew count model, with the full math shown on the PDF.
- Shifts became a first-class concept on jobs, replacing free-text shift labels.

### May 1–5
- Quote rewrite: new drafts list and editor, quote revisions with "superseded by" links, printable letterhead PDF with optional rate schedule.
- Jobs gained per-day breakdowns with crew requirements per position, plus job numbers (e.g. 26-0142-COA) auto-derived from client and date.
- Assigned Crew tab: schedule specific employees per day against the requirements, with staffing-level indicators.
- Rate cards: overtime trigger rules (No OT / Weekly-40) that auto-derive OT and DT rates.
- Timekeeping sign-in sheet print layout overhauled: two rows per employee, signature boxes, day filtering, page breaks per day.
- Company info (name, address, logo block) editable under Maintenance.

## April 2026

### April 29
- Fixed a data-corruption bug where loading one quote could overwrite another (the Connor incident), and added save-reliability guards: duplicate-invoice warnings, real error messages when a save fails, and no more silent failures.
- Clients: contacts list on each client, active/inactive filtering, 3-letter client codes with duplicate prevention.
- Jobs screen redesigned to a browse-list + detail layout, with real file attachments stored in the cloud.
- Rate cards: effective dates for time-versioned cards, and lockouts to prevent cross-client mistakes.
- Non-production environments now show a banner so test sites can't be mistaken for the live app.

### April 22–27
- New operational dashboard: revenue, unpaid invoices, upcoming events, and crew pipeline at a glance.
- Central Timesheet Review page: filter and approve/reject submitted time across all jobs.
- Invoice PDF: grouped by date with daily totals, cleaner header with prominent amount due.
- Quote and invoice line editor moved to a two-row color-banded layout.
- Employee profile pictures and documents moved to cloud storage; profile doubles as the add/edit form.
- Collapsible sidebar; every printed PDF gets a meaningful filename.

### April 15–20
- Employee management: full user account administration, employee directory improvements, and job/timesheet history on each employee profile.
- Crew leader portal at /lead — job and timekeeping access with no pay information.
- Positions and specialties became managed lists (Maintenance) instead of hardcoded values.
- Clients became a master list, with quotes, invoices, jobs, rate cards, and calendar events all linked to a client record and visible from the client screen.
- The master calendar's 586 static events were migrated into the database.
- Timekeeping: employee autocomplete linking and the approval workflow (submitted → approved/rejected).

### April 11–14
- Initial launch: the app moved off browser-local storage onto a real cloud database (Supabase) with user logins and role-based access.
- Job costing screen fixes.
