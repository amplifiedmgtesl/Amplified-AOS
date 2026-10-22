# Amplified AOS — Change Log

What changed and when. Newest entries at the top.

## October 2026

### October 22 — v2.13.0
- **Duplicates that are spelled differently are now caught.** The same "sounds like" matching as the employee search now runs when AOS looks for duplicates and Paychex matches. Two records whose names sound the same and are only a letter or two apart (for example *Amber Slicht* and *Amber Schlicht*) show as **Sounds alike** under **AOS duplicates** on Onboarding and on the employee profile, ready to **Merge** or mark **Not same**.
- A Paychex worker whose name sounds like the person shows as a possible match with **Use ID**. It's never linked automatically; only a matching email, phone or exact name does that.
- **Sync from Paychex** no longer adds a new Paychex hire whose name sounds like someone already in AOS. It holds them under **To check by hand** so nobody ends up in AOS twice.

### October 21 — v2.12.1
- Clearer button names on **Onboarding**: **Reload list** re-reads who's on a job without a Payroll ID, and **Update from Paychex** (was "Refresh now") reads Paychex again and applies its changes. **Update from Paychex** is the same on the Payroll page and employee profiles.

### October 20 — v2.12.0
- **AOS now keeps a copy of Paychex** and refreshes it every **Monday night**, instead of reading Paychex every time a page opens. Onboarding, Sync from Paychex and employee profiles open faster and no longer use up Paychex lookups. **Paychex as of …** shows how fresh the copy is; **Refresh now** reads Paychex again (about 30 seconds).
- **Each refresh applies Paychex's changes on its own:** email, phone, address and status, new hires, and Payroll IDs that clearly match. Anything unclear (for example, one Paychex person who could be two AOS records) still waits under **🔄 Sync from Paychex** on the Payroll page for you to decide.
- **Sent and waiting:** after **Send to Paychex**, the person shows **Sent … · waiting** on Onboarding and their profile, and **sent to Paychex …, waiting** (in amber) on payroll runs and crew/timekeeping screens, until they finish setting up in Paychex. Their Payroll ID is then filled in automatically.
- **Employee profiles have a Paychex section** (admins). Without a Payroll ID: possible duplicates (**Merge** / **Not same**), possible Paychex matches (**Use ID**), and **Add to Paychex**, which stays greyed out until there's nothing left to sort out; hover over it to see why. With a Payroll ID: **Sync from Paychex** for just that person.
- **Onboarding is now in date order:** the person who has waited longest to be paid is on top, and people only booked for future jobs are at the bottom. Each row shows the first and last date worked.

### October 20 — v2.11.1
- **Did you mean:** now works from 3 letters, so short last names are caught too ("dow" finds Doe).

### October 20 — v2.11.0
- **Fewer duplicate employees.** When you search for a person (Timekeeping, **+ Add Crew Member**, crew screens), a new **Did you mean:** list under the results shows people whose name *sounds* like what you typed: a misspelling ("bowmen" finds Bowman), a nickname ("Mike" finds Michael) or first and last name swapped. It shows even when there are exact matches, because "Branden" may really be the Brandon you meant. If nothing matches, **+ Create employee** becomes **None of these — create**, so picking the existing person comes first.
- People who are set up in Paychex (they have a Payroll ID) show a green **Payroll ✓** next to their name in the search, so you can tell the real record from a duplicate.
- The search list now fits on the screen and scrolls on its own, instead of running off the bottom of the window.

### October 20 — v2.10.1
- Removed the one-time **Load website applications** page. All past applications are now in the Employee list, and new ones arrive on their own as people apply.

### October 20 — v2.10.0
- **People who apply on the website now go straight into the Employee list.** When someone sends the Employee Application on amplifiedesl.com, AOS first looks for them, by email, then phone, then exact name, because a crew lead may already have added them. If they're found, only blanks are filled in; nothing already in AOS is overwritten. If they're new, they're added as a **Contractor**. That way the right person is there to pick when you book a crew, with their email ready for Paychex.
- **Applied with: …** under an email or phone means their application has a different one from what's in AOS. Click it to use that instead. It shows on the **Onboarding** page and on the person's profile.
- On the **Onboarding** page, each person's name is now underlined like a link: click it to open their profile.
- An employee's profile shows **Applied on website** with the date (it opens their application and résumé in JotForm if you're signed in there) and their answer to the text-message question.
- **Employees list:** a new **Applied Online** filter. Click any column heading to sort by it; click it again to reverse. The Employee Key column is gone from the list (it's still on each profile).
- Past applications are loaded once from JotForm's export, by an admin.

### October 20 — v2.9.0
- **Payroll IDs are now filled in automatically when the match in Paychex is clear.** On the **Onboarding** page this happens as soon as the page opens; the person drops off the list and a green **Linked from Paychex** line shows who was linked. **🔄 Sync from Paychex** on the Payroll page does the same when its preview loads. Everything else in the sync still waits for you to tick it and click **Apply**.
- A match counts as clear only when Paychex has exactly one possible worker for the person and it already has a Payroll ID; it matched on email, phone, or the exact name (a name-only match must be an active Paychex worker whose contact details don't disagree); the person has no possible duplicates in AOS; and no other record already has that Payroll ID. Anything less certain is still shown for you to decide with **Use ID**.
- Every automatic link is logged with the record as it was before, so it can be undone.

### October 20 — v2.8.2
- **Merge** on the Onboarding page now lets you choose the **name**, **email** and **phone** to keep when the two records have different ones. Under the two records you'll see each value that differs, with the kept record's already selected; pick the other one if it's right. If one record is blank, the other record's value is filled in automatically as before. All crew assignments, timesheets and payroll entries still move to the record you keep.

### October 20 — v2.8.1
- The **Onboarding** page now fits a normal laptop screen without scrolling sideways. Each person's details are grouped into fewer, narrower columns; on a small screen only the table scrolls, not the whole page.
- Paychex is now checked automatically as soon as you open Onboarding. The Paychex column shows **Checking…** for about 30 seconds and then the results. **Send to Paychex** and the tick boxes stay greyed out until that person has been checked, so nobody can be sent before you've seen whether Paychex already has them.

### October 20 — v2.8.0
- New **🪪 Onboarding** page (admins only). It lists everyone on a confirmed crew assignment or a timesheet from the last 30 days through the next 30 days who has no **Payroll ID**. Those are the people who would be left out of the Paychex payroll file. People with hours are at the top.
- Fill in a missing **email** or **phone** right on the list (blanks are outlined in red), and click **Employee / Contractor** to switch someone between W-2 and 1099.
- **AOS duplicates:** if another employee record looks like the same person (same email, same phone, or the same or a very similar name), it's shown next to them. **Merge** moves all their crew assignments, timesheets and payroll entries onto the record you keep, then deletes the other one (a backup is kept). **Not same** stops flagging that pair.
- **Check Paychex** looks everyone up in Paychex and shows every Paychex worker who might be them. Paychex has its own duplicates, so there can be more than one. **Use ID** puts that Payroll ID on the AOS record.
- **Send to Paychex** adds a new person to Paychex and Paychex emails them an invite to finish their own setup (SSN, address, tax forms, direct deposit). It needs an email first. If Paychex already seems to have the person, you're shown who before anything is sent. After a send the row shows **Sent** until Paychex gives them a Payroll ID; then use **Check Paychex** and **Use ID** to link it.
- **Send several at once:** tick the people to send (the box at the top ticks everyone who can be sent) and click **Send selected**. You confirm the whole list once. Anyone Paychex may already have is skipped and listed afterwards, so they can be checked and sent one at a time.

### October 14 — v2.7.0
- New **🔄 Sync from Paychex** button on the Payroll page (admins only). Paychex is now the source of truth for each person's Payroll ID, phone, email and address, and crew can update their own details in Paychex. The button reads Paychex and shows what would change in AOS before anything happens. Untick anything you don't want, then click **Apply**.
- What the sync can do: update contact info, give someone the Payroll ID Paychex has for them, add new Paychex hires to AOS, and fix an AOS Payroll ID that doesn't exist in Paychex. A blank in Paychex never wipes out what AOS has. Every change is logged with the record as it was before.
- Each employee's **Payroll Name** now holds their name exactly as Paychex has it. The name shown everywhere else in AOS is still the name they go by, so legal names and spelling differences no longer cause mismatches.
- **Status** now follows Paychex: terminated in Paychex means **Terminated** in AOS; active or on hold means **Active**.
- Terminated people no longer appear when you pick someone for a crew or timesheet row. To find one anyway, use the 🔍 search and tick **Include terminated**. Someone already on a job still shows by name.
- Anything the sync can't decide by itself is listed for a person to check, such as someone Paychex has under two numbers. Nothing on that list is changed.

### October 14 — v2.6.1
- The **📥 Paychex CSV** button now only works once a payroll run is **Finalized**. On a draft run it's greyed out. Weekly overtime for W-2 employees (hours over 40 in a Sunday–Saturday week) is only worked out when a run is finalized, and Paychex pays the file exactly as sent. A draft export would have paid those overtime hours at straight time. Finalize first, then download the file.

### October 12 — v2.6.0
- Payroll now exports to **Paychex**. On a payroll run, the **📥 Paychex CSV** button (it replaces the Rippling button) downloads a file ready for Paychex Flex: Payroll Center → arrow next to Begin → Import. Each person gets one line per job, per pay type and per rate, with the hours added up for the whole pay period. Rates come straight from the payroll run, so the file adds up to the same total as the Payroll Report.
- W-2 employees are sent as **Day Rate 1** and contractors as **1099 - Day Rate 1**. Overtime and double time go on their own lines under the same code at the overtime or double-time rate, with **OT** or **DT** added to the job name (for example "LBFT OT") so they're easy to spot.
- Anyone missing a **Payroll ID**, or not marked Employee or Contractor, is left out of the file. Before downloading you get a list of who was left out, with their hours and pay, so they can be entered in Paychex by hand.
- New **Maintenance → Payroll Export** tab: the Paychex Company ID, what goes in the Job Name column (the job's short Event Abbr for now), and the exact Paychex pay component names. Copy and paste those from Paychex. They have to match exactly, or Paychex rejects the line.
- **Employment Type** on an employee is now just **Employee** (W-2) or **Contractor**. The old mix of values ("Independent Contractor", "W2", blank) has been cleaned up, and only the people on the W-2 payroll are marked Employee. This also decides who gets weekly overtime.
- Payroll problems now show up as soon as someone is added to a job, instead of on payday. When someone is picked for a crew assignment or a timekeeping row and has no Payroll ID or no Employee/Contractor setting, a small red note appears next to their name. The job's **Health Check** and the timekeeping banner list them too, along with any timekeeping rows not linked to an employee. These are warnings only: nothing stops you from scheduling or entering time.
- "Rippling Emp No" is now called **Payroll ID**. It's the same number, since Paychex kept the Rippling numbers. The missing Payroll IDs that were worked out in September have been filled in.
- Fixed: the **Timesheet** button on a job opened Timekeeping on whichever job was used last, not the job you were on. It now opens that job's timesheet.

### October 11 — v2.5.2
- Fixed: on **Timesheet Review**, picking a name in the **Employee** filter showed nothing for about half the crew (Mike Lawler and Sean Mooney, for example), even with every status, job and date selected. The filter matched people by email, so anyone whose entries had no email on file never matched. It now matches on the person's employee record. Only the old entries from before every entry was tied to an employee record still match by email or name.
- Fixed: Timesheet Review only loaded the 1,000 most recently changed entries, out of about 3,750. Everything older was quietly left off the page, including about 740 entries still marked Submitted, all from July or earlier. The page now loads every entry. Expect those older Submitted entries to show up under **Pending**.

## September 2026

### September 28 — v2.5.1
- Fixed: the Rate Card page could wipe a client's rates. When the page opened, it showed the client card's name at the top but filled the table with the generic starting rates ($35 stagehand, $50 rigger, $42 crew chief and so on) instead of that card's own rates. Clicking **Save Rate Card** then wrote those generic rates over the real card. If someone changed a couple of rows and saved, those rows kept the new numbers and everything else on the card went back to the generic rates. The page now opens showing the card's actual rates, the same as picking the card from the list. Cards that may have been affected are being checked by hand — nothing has been changed on them automatically.

## August 2026

### August 30 — v2.5.0
- Day rate is now set on the job's **day record**, not worked out from the quote. Each day of a job can be marked Day Rate or Hourly, with the number of hours the day rate covers stored alongside it. Payroll reads that. The quote can still override a single specialty — if one role is billed hourly on an otherwise day-rate day, that still works — but the day is what everyone else follows.
- This fixes people being paid the wrong way because of how they were booked. On the Neon Nights run, the crew lead was paid 17 clock hours on two days while the twenty stagehands she was supervising were paid a flat 10, purely because "Stagehand Lead" wasn't one of the roles on the quote. Riggers booked as "Up" but quoted as "Climber" had the same problem. Those people now follow the day like everyone else.
- The hours a day rate covers are no longer worked out by dividing the day rate by the hourly rate. That division was wrong whenever the two rates weren't set consistently — on an upcoming September job it produced 17-hour and 19-hour "days" for two roles because a flat $650/day was quoted while their hourly rates were left at the rate-card default. The day record's own number is used instead.
- Existing days have been set from the job's schedule, so nothing changes for work already entered. Payroll runs already created keep the hours they were built with; to pick this up, void the run and create a new one.

### August 30 — v2.4.1
- Fixed: voiding a payroll run always failed. The Void button returned "tuple to be updated was already modified by an operation triggered by the current command" on any run that had entries on it — which is every real run. The cause was two database triggers fighting: voiding a run deletes its entries, and deleting entries recalculates the run's totals, which tried to update the same run row that was still mid-void. Confirmed against production: no payroll run had ever reached voided status. Voiding now releases the entries first, so the totals recalculation and the status change no longer collide. The timesheet entries go back into the candidate pool as they always should have, ready for a fresh run.

### August 30 — v2.4.0
- Payroll now pays day rates on jobs that were quoted at day rates. Where a day was sold as a flat day rate, payroll pays the number of hours that day rate covers instead of the hours on the timesheet — so a stagehand on a $330 day (a $33/hr rate, so a 10-hour day) is paid 10 hours, whether the timesheet says 3 hours or 17. This is deliberate: on a day-rate job the crew check in and stay on call across the whole span, used on and off rather than working straight through, which is the reason the job is priced that way in the first place. Half days need nothing special — a day quoted at $165 covers 5 hours, so it pays 5. It reads this straight off the issued quote, so there is nothing to switch on and no way for pay and billing to disagree about which days were day rate.
- The 40-hour weekly overtime rule now applies to employees only. Contractors are no longer pushed into overtime when their week goes past 40 hours. Anyone not explicitly marked as an employee is treated as a contractor. Where an individual genuinely needs overtime — a state rule, or their own contract — that is handled in Rippling.
- Both changes apply to payroll runs created from now on. An existing draft run keeps the hours and rates it was built with; to pick these up, void it and create a new run for the job.

### August 29 — v2.3.4
- Payroll accounts no longer have Timekeeping or Timesheet Review. Both are gone from the payroll sidebar, and the direct links are blocked as well. Entering and approving hours stays with operations; payroll works from already-approved time on the Payroll screen. This reverses the access granted on August 4 in v2.3.0. Payroll accounts keep Payroll, Employees, and read-only Jobs.

### August 25 — v2.3.3
- "Add Crew from Job" now asks before adding crew to a day that already has time entered, and lists exactly who it is about to add to that day. It could previously append to a finished, approved day with no warning at all — which is how five extra names turned up on a Neon Nights day that had already been entered and emailed out. Four of them were people already on that day under a second, duplicate employee record, which the button had no way of noticing.
- "Add Crew from Job" also no longer creates a blank, nameless row for a crew slot that has nobody assigned to it yet. Those rows looked like real time once approved. It now skips them and tells you how many it skipped, so you can fill them in on the job's Assigned Crew tab.

### August 25 — v2.3.2
- Fixed: crew added with "+ Add Crew Member" never picked up the job's rate card. Those rows kept a fixed default rate and had no overtime rule at all, so on a job where some crew came from the job's assigned crew and others were added by hand, the same 14-hour shift could show as 10 hours plus 4 overtime on one row and 14 straight hours on the row below it. Hand-added rows now take their rates and their overtime and doubletime rules from the rate card as soon as a specialty is picked.

### August 4 — v2.3.1
- Timekeeping: the Status column on the right of the grid is more compact. The "No 5hr min" label was wrapping onto three lines, which added height to every crew row. Checkboxes across that grid were being stretched to a fixed width, which also left the "Select" tick box sitting a gap away from its own label — both are fixed.
- The Job # message now tells you exactly what it's waiting for instead of listing everything. In particular it now names the client's 3-character Code, which is required for a job number but was never mentioned — so a job could have a client, an event name and a start date and still show no number with no explanation. Client codes are set on the Clients screen.

### August 4 — v2.3.0
- Payroll users can now open Timekeeping and Timesheet Review, and approve or reject submitted time. Billing amounts stay hidden on both screens, the same as for coordinators and crew leaders.
- Jobs can now be marked exempt from the 5-hour payroll minimum, using a checkbox on the job screen. Time booked to an exempt job pays the exact hours worked — no 5-hour minimum and no rounding up to the next whole hour. This is for internal or office jobs, like the one coordinators log their own time against.
- Individual timesheet entries can also be marked exempt, using the "No 5hr min" checkbox on each row in Timekeeping. Use it when someone shows up late for a call: they still get paid for the time they worked, but forfeit the 5-hour minimum for that shift. Anyone with Timekeeping access can set it, including crew leaders. The checkbox locks once the entry has been pulled into a payroll run.

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
