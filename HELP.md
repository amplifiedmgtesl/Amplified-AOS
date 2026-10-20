# AOS Help

Welcome to the Amplified Operations Suite (AOS). This guide explains each screen: what it's for, when you use it and how to do the common tasks. The **? Help** button at the top of any page opens this guide at that page's section.

## Getting started {#overview}

**Signing in.** Use the email and password your manager set up for you. What you see depends on your role:

- **Admin**: everything.
- **Coordinator**: Calendar, Clients, Jobs, Timekeeping, Timesheet Review and Employees.
- **Crew Leader**: Jobs, Timekeeping, Employees and the Time Clock.
- **Payroll**: Payroll, Employees and Jobs (view only).

If this guide mentions a button you don't see, it belongs to another role.

**Finding your way around.** The menu down the left side takes you to each area. On a phone, tap **☰** at the top to open it. **Sign out** is at the bottom of the menu.

**How a job works, start to finish.** Every job follows the same path. Each step has its own screen:

1. **Set up the job**: who the client is, what the event is, where and when. (*Jobs*)
2. **Lay out the days**: the dates, the times and how many of each kind of worker are needed. (*the job's Daily Requirements tab*)
3. **Quote the job** from those requirements. (*admins*)
4. **Plan the crew**: who is working each day. (*the job's Assigned Crew tab*)
5. **Print the paperwork** for the site: the crew schedule and the sign-in sheet. (*the job's Print button*)
6. **Record the time actually worked**, from the sign-in sheet or by having the crew clock in at the **Time Clock**. (*Timekeeping*)
7. **Approve the time.** (*Timesheet Review*)
8. **Review, invoice and pay.** (*admins and payroll*)

**The key idea:** the **job** holds the plan (what's needed and who's scheduled), and **Timekeeping** holds only what actually happened. Never enter planned times as if they were worked.

## Dashboard {#dashboard}

**What it's for:** the admin's home page, a quick look at what needs attention.

- **Upcoming Events**: jobs coming up, with client, event, venue and crew.
- **Awaiting Approval**: timesheet rows waiting to be approved.
- **Open Quotes** and **Unpaid Invoices**: work waiting on a client.
- **Understaffed (14 days)**: upcoming jobs that don't have enough confirmed crew yet. Check this every day.

**Open Calendar** jumps to the calendar.

## Calendar {#calendar}

**What it's for:** seeing every job laid out by date.

- Switch between **Month** and **Day** with the buttons at the top, and use **Prev** / **Next** to move through time. Click a day's number to see that day.
- **Hover** over a job for a quick summary. **Click** it to open its profile, where you can add **Job Notes** and files, open the venue in **Google Maps**, or add it to your **Google Calendar**.
- **Add All Visible Events to Google Calendar** copies everything you're looking at to your own calendar.

Jobs appear on the calendar when **Show in app calendar** is set to **Yes** on the job. To add something to the calendar, create a job (see *Setting up a job*).

## Clients {#clients}

**What it's for:** the list of companies you work for.

**Finding a client.** Type in the search box (name, contact or code). Use **Active**, **Inactive** or **All** to filter, and click **Open** to see one.

**Adding a client**

1. Click **+ New Client**.
2. Enter the **Client Name**.
3. Enter a **Client Code**: exactly 3 letters or numbers (for example "JAY"). It becomes part of every Job # for this client, so choose something recognisable. Each active client needs a different code.
4. Add the contact details and click **Save**.

**On a client's page,** the tabs show their **Contacts** (people to call or send paperwork to; add them with **+ Add Contact**) and their **Jobs**. You can start a job for them with **+ New Job**.

**A client you no longer use:** click **Deactivate**. They stop appearing in drop-down lists but their history stays.

**Duplicates:** if the same client has been entered twice, click **Merge Clients**. Choose the one to remove as the **Source** and the one to keep as the **Target**, then click **Merge**. Everything moves to the one you keep. This can't be undone, so double-check first.

## Employees {#employees}

**What it's for:** the directory of everyone who works for us.

**Finding someone.** Search by name, phone or email, or filter by **City**, **State**, **Status** or **Employment Type**. Click a name to open their profile.

**Adding someone**

1. Click **+ Add Crew Manually**. A new blank profile opens.
2. Fill in their **Full Name**, **First Name**, **Last Name**, **Phone**, **Email**, **City** and **State**.
3. Set **Employment Type**: **Employee** for W-2 staff (they get weekly overtime), **Contractor** for everyone else.
4. Enter their **Payroll ID**, their Paychex worker number. Without it they're left out of the Paychex file, and a red **no Payroll ID** note shows next to their name on crew and timekeeping screens.
5. There is no Save button: changes save as you type.

**Before adding someone, search first.** The same person entered twice causes problems on timesheets. If you find a duplicate, tell an admin rather than deleting it.

**Terminated people** don't appear when you pick someone for a crew or timesheet row. If you really need one, use the 🔍 search and tick **Include terminated**. A terminated person already on a job still shows there by name. Status is kept in step with Paychex by **Sync from Paychex**.

**On a profile** you'll also find **Notes**, uploaded **Certificates / ID / Files**, and their **Job History** and **Timesheet History**.

**Adding many at once:** **⇪ Import from CSV** lets you paste rows copied from a spreadsheet.

## Jobs list {#jobs-list}

**What it's for:** finding any job.

- The **Status** drop-down starts on **Active** (Lead, Quoted and Booked). Choose **All statuses** to see finished or lost jobs too.
- Search by Job #, client, event or venue.
- **📅 Calendar** shows the same jobs on a calendar.
- Click a job to open it, or **+ New Job** to start one.

## Setting up a job {#jobs}

**Who:** Admins, coordinators and crew leaders.

**What it's for:** the job record holds everything about one event: the client, the venue, the dates, what crew is needed and who's been scheduled.

**Creating a job**

1. Go to **Jobs** and click **+ New Job**.
2. Choose the **Client** and fill in the **Event Name** and **Event Start Date**. These three are required before the job gets its Job #.
3. Fill in the **Event Abbr** (a short name, up to 8 characters, used in the Job #), the venue and address, the **Event End Date**, the **Start Time** / **End Time** and any **Notes**.
4. Set **Show in app calendar** to **Yes** so it appears on the calendar.
5. Click **Save**.

**The Job #** is built automatically from the start date, the client's code and the event abbreviation. Use it whenever you talk about a job.

**Job status.** Choose it from the **Status** list:

- **Lead**: a possible job, still being worked out.
- **Quoted**: the client has a quote.
- **Booked**: confirmed. The job is going ahead.
- **Completed**: the work is done.
- **Lost**: it isn't happening.

Status doesn't change by itself. Update it as the job moves along.

**Why some fields are greyed out.** Once a job is past **Lead**, its main details lock so nobody changes a confirmed job by accident. **Daily Requirements** and **Assigned Crew** stay editable while the job is **Booked**, because scheduling carries on. **Completed** and **Lost** lock those too. To change a locked detail, set the status back to **Lead**, make the change, then set it back.

**The tabs on a job**

- **Daily Requirements**: the days, times and crew needed.
- **Assigned Crew**: who is working each day.
- **Shifts**: separate calls within a day, if the job has them.
- **Attachments**: files for the job (floor plans, maps, contracts, photos).
- **Health Check**: problems with the job's setup that need fixing.

**Buttons along the bottom of a job:** **Save**, **Timesheet** (opens this job in Timekeeping), **Print** (the job's paperwork) and **Add to Google Calendar**. Admins also see the quote buttons and **Pre-Invoice Report**.

**Warnings at the top of a job**

- **No shifts defined on this job**: fine if the day is one continuous call. Add shifts if it has separate calls.
- **Header dates don't match day rows**: the job's start/end dates disagree with the days on Daily Requirements. Fix whichever is wrong.
- **Possible duplicate**: another job looks the same. Check you're not entering it twice.

### Shifts {#shifts}

If a day has separate calls (for example Load In, Show Call, Strike), open the **Shifts** tab, type a label and click **Add Shift** for each one. Do this before assigning crew. When a job has two or more shifts, every crew member must be put on a shift.

### Attachments {#attachments}

Click **+ Upload File(s)**, choose the files and pick a **Type** for each. Anyone working the job can open them from here.

### Health Check

This tab checks the job automatically and lists anything that needs fixing. See *Health Check* below for what each check means.

## Daily Requirements: days and crew needed {#requirements}

**Who:** Admins and coordinators.

**What it's for:** this tab is the outline of the job: which days, what times, and how many of each kind of worker. Everything else reads from it. The quote is priced from it, the crew is planned against it, and the paperwork prints its times.

**Adding the days**

1. Open the job and go to **Daily Requirements**.
2. Click **+ Add Day**.
3. Set the **Date**, **Call Time**, **Start Time** and **End Time**.
4. If the crew works, takes a meal break, then works again, enter the second stretch in **2nd Start** and **2nd End**.
5. Set **Rate**: **Hourly** (the default) pays crew by the clock. **Day Rate** pays each worker a flat block of hours for the day, however long they actually work. Enter that block in **Day Rate Hrs**; it starts at the day's **Exp Hrs**, but changing Exp Hrs later never changes pay.
6. Add a note if it helps (for example "Load-in day").

**Adding the crew needed**

1. Under **Crew Needed**, click **+ Add Position**.
2. Choose the **Position** and, if it matters, the **Specialty**.
3. If the job has shifts, choose the **Shift**.
4. Enter how many people you need in **Qty**.
5. Repeat for each kind of worker.

**Shortcuts and tips**

- **Dup ↑** copies the day above, times, Rate and crew needed included. It's the quickest way to build a multi-day job; then adjust what differs.
- Tick **Holiday** if the day is a holiday.
- **+ Add Day** gives the new day the same Rate as the last day, so a day-rate job stays day-rate as you add days.
- **Rate matters for payroll.** If the quote prices a role at a day rate, that role is paid the day rate. Anyone working a role the quote doesn't list is paid by the day's Rate. Set it to match how the job was sold.
- **Every day needs a start and end time.** Without them, the paperwork for that day won't print and the crew can't be brought into Timekeeping.
- **Delete day** removes a day. Once anyone has time recorded on a day, it can't be deleted or moved to another date.

## Creating the quote {#quotes}

**Who:** Admins.

**What it's for:** turning the job's requirements into a quote for the client.

1. Fill in **Daily Requirements** first. The quote is built from them.
2. On the job, click **Create Quote** (or **Save + Create Quote** when creating a new job).
3. In **Edit Quote Draft**, check every line. Click **Save Draft** as you go; drafts can be changed freely.
4. When it's right, click **Issue Quote**. An issued quote is final and can't be edited.
5. Use **Print / PDF** to send it to the client.
6. When the client signs, open the quote and click **Mark Signed**.
7. Set the job's **Status** to **Booked**. This isn't done automatically.

**Need to change an issued quote?** Open it and click **Revise**. This makes a new version and keeps the old one for the record.

**The Quotes list** shows all quotes. Use the drop-down to see drafts, issued or signed quotes, and search by quote #, client or event. New quotes are always started from the job.

## Assigned Crew: planning who works {#crew}

**Who:** Coordinators and admins.

**What it's for:** this is the **plan**: exactly who is working each day, in what position, and when. Fill it in for every job. The crew schedule, the sign-in sheet and the Time Clock all come from it, and Timekeeping brings people in from it.

**Assigning people**

1. Open the job and go to **Assigned Crew**.
2. Each day shows how many people are needed and how many are filled, for example "3/5 spec filled" or "−2 short".
3. Click **+ Add Crew Member** and choose the **Employee**, **Position**, **Specialty** and **Shift** (if the job has shifts).
4. When the person has agreed to work, tick **Confirmed**.
5. Keep going until no day is short.

**Copy ↑** copies the previous day's crew onto this day, which helps when the same people work every day.

**Planned times**

- Under each person you'll see their planned times. **Grey** times are the day's normal times from Daily Requirements; you don't need to type anything if they're working the normal day.
- If someone is starting or finishing at a different time, type over their times. They turn **dark** to show they're specific to that person.
- **↺** puts the person back on the day's normal times.
- If a day says **Planned day window: none set**, the day has no times yet. Add them on Daily Requirements.

**Rosters.** **Export Roster** downloads the crew list as a spreadsheet; **Import Roster** brings an edited list back in.

## Printing the job paperwork {#printing}

**Who:** Everyone, mostly crew leaders.

**What it's for:** the paper you take to the site, and the record afterwards.

1. Open the job and click **Print**.
2. Choose the **Document** and the **Day**.
3. Click **Print / Save as PDF**.

**The documents**

| Document | Use it | What it is |
|---|---|---|
| **Crew Schedule (before)** | Before the job | Your reference list: who's coming, their position and shift, their scheduled times and phone number. Nothing gets written on it. |
| **Crew Sign-In Sheet (during)** | At the job | The form the crew fill in. Each person signs in and writes their Time In, Time Out and meal break, for each part of the day. |
| **Timesheet — Actuals (after)** | After the job | The record of the hours actually worked, with the signatures collected at the Time Clock. |
| **Job Summary** | Any time | The whole job on one page: venue, requirements, assigned crew and notes. |

**Options**

- **Sort:** by last name, first name or position.
- **Include unassigned & unconfirmed:** also lists open spots and people who haven't confirmed.
- **Blank rows:** adds empty rows to the sign-in sheet for people who turn up unplanned.
- **Include no-shows:** lists the people who didn't come, on the actuals timesheet.

**Tips**

- These documents print best **landscape**. On Safari, iPhone or iPad, choose Landscape yourself in the print window.
- To make a PDF instead of printing, choose **Save as PDF** as the printer.
- **Can't print — no start/end times** means a day is missing its times. Add them on Daily Requirements.

## Timekeeping: recording time worked {#timekeeping}

**Who:** Crew leaders, coordinators and admins.

**What it's for:** recording the hours each person **actually worked**. This is what invoicing and payroll are built from, so it must be accurate.

**Recording a job's time**

1. Go to **Timekeeping** and choose the **Job**.
2. Click **Add Crew from Job**. Everyone on the job's Assigned Crew is brought in, one row per person per day. Their times start **blank**.
3. Using the sign-in sheet, enter each person's real **Time IN** and **Time OUT**, and their second Time In/Out if they came back after a break.
4. If someone worked who wasn't on the plan, click **+ Add Crew Member** and add them.
5. If the crew clocked in at the **Time Clock**, their times are already filled in. Check them.

A time past midnight shows **(+1)**, meaning the next day.

**Always enter the actual times.** Use what's on the sign-in sheet or the Time Clock, even if it matches the plan. **Copy Planned** (tick rows, then use the button in the bar that appears) fills in the *planned* times instead. It is a **last resort**, only for when the real times can't be recovered, and it asks you for a reason, which is saved in the job's notes.

**Greyed-out time boxes** mean the row is missing its **Position**, **Specialty** or **Shift**. Hover over the box to see which, fill it in, and the times unlock.

**What each status means**

- **Planned**: on the schedule; no time entered yet.
- **Pending**: time entered, waiting for approval.
- **No Show**: the person didn't turn up. An admin marks this with **No Show**; it's only available on rows without a time.
- **🔒 Approved**: approved and locked.
- **🔒 Billed**: on an invoice and locked for good.
- **Rejected**: sent back for correction.

**Copying days.** **Copy ↑ prev day** and **Copy → new day…** copy the **people** from one day to another. Times start blank, so enter each person's actual times as usual.

**The Time Clock.** Crew leaders and admins can open the **⏱️ Time Clock** from here (see *Time Clock*).

## Timesheet Review: approving time {#review}

**Who:** Admins and coordinators.

**What it's for:** checking and approving recorded time across all jobs. Only approved time goes on invoices and into payroll.

1. Go to **Timesheet Review**. It opens on **Pending (needs approval)**.
2. Narrow the list with **Employee**, **Job** or the dates.
3. Check each row against the sign-in sheet.
4. Tick the rows that are right and click **Approve**. Tick any that are wrong and click **Reject**.

**Other views:** **Planned (not yet worked)** shows rows still waiting for their times; useful for chasing missing timesheets after a job. **No Show**, **Approved** and **Rejected** show those rows.

**To fix an approved row,** an admin unlocks it on the Timekeeping screen.

## Time Clock: crew clocking in and out {#timeclock}

**Who:** Run by a crew leader or admin on a shared tablet or phone; used by the crew themselves.

**What it's for:** letting each crew member record their own start and finish times, with their signature, as it happens.

**Opening it**

- **Crew leaders:** tap **Time Clock** in the menu, or the **⏱️ Time Clock** button on Timekeeping.
- **Admins:** the **⏱️ Time Clock** button on Timekeeping.

It opens full screen in its own tab, signed in as you. The crew don't need logins. **Exit** closes it.

**Setting up at the start of the day**

1. Choose the **Job**. Only jobs running yesterday, today or tomorrow are listed.
2. Choose the **Work day**.
3. Check the banner says **Punching for** today's date. **⚠ Not today** means you're on another day.
4. Hand the device to the crew.

**Tip for iPads:** use **Add to Home Screen** so the Time Clock opens full screen like an app, and turn on **Guided Access** (Settings → Accessibility) so nobody can leave it.

**How the crew clock in and out**

1. Find your name and tap it.
2. Tap **Time In 1**, sign with your finger, and tap **Confirm Time In 1**.
3. At your break, tap **Time Out 1** and confirm.
4. Coming back after the break? Use **Time In 2** and **Time Out 2** the same way.
5. Wait for the green **recorded** message before handing the device on.

**Good to know**

- Times are rounded to the nearest 5 minutes.
- A shift that runs past midnight stays on the day it started.
- **Punch NOT recorded**: the time didn't save. Write it down and enter it on Timekeeping.
- **No position set — see your crew leader**: that person's row needs its position, specialty or shift. The crew leader fixes it on Timekeeping, then the person can clock in.

## After the job: reports and review {#reports}

**Who:** Admins.

**Pre-Invoice Report.** On the job, click **Pre-Invoice Report**. It opens in a new tab with the job's hours by position and shift and a list of no-shows. It includes time not yet approved, so you can check a job before invoicing it. Click **Print / Save as PDF** to keep or send it.

**Signed timesheet.** From the job's **Print** button, choose **Timesheet — Actuals (after)** for the record of hours worked with the crew's signatures.

**Health Check.** Look at the job's **Health Check** tab before invoicing and fix anything listed (see *Health Check*).

**Job Costing.** **Job Costing** in the menu tracks a job's costs. **Sync Timekeeping Actuals** brings in the latest hours.

## Invoicing {#invoicing}

**Who:** Admins.

**What it's for:** billing the client for the work, based on approved time.

1. Make sure the job's time is **approved** (see *Timesheet Review*).
2. Open the job's issued quote. Click **Generate Final Invoice…** (or **Generate Deposit Invoice** for a deposit).
3. Choose **Bill the entire job** or **Bill specific dates**.
4. In **Edit Invoice Draft**, click **Overwrite from Timesheets** to bring in the approved hours. Check the lines against the comparison section underneath.
5. Click **Issue Invoice**, then **Print / PDF** to send it, and **Mark Sent**.
6. When the client pays, click **Record Payment**.

Once time is on an invoice, it shows **🔒 Billed** on Timekeeping and can't be changed. To correct an issued invoice, use **Revise**.

**The Invoices list** shows all invoices. Use the drop-down to filter by draft, issued, sent or paid, and search by invoice #, client or event.

## Payroll {#payroll}

**Who:** Admins and payroll.

**What it's for:** paying the crew for approved time.

1. Go to **Payroll** and click **+ New Payroll Run**.
2. Under **Filter candidate entries**, set the dates and click **Search candidates**.
3. Under **Review entries to include**, check the list.
4. Set the pay date and click **Create draft run**.
5. Open the run and check **Included entries**. Add anything missed under **Add more entries**.
6. Click **Finalize**. This works out weekly overtime for W-2 employees and locks the run.
7. Click **📥 Paychex CSV** to download the import file. The button only works on a finalized run. In Paychex Flex, go to **Payroll Center**, click the arrow next to **Begin** and choose **Import**.

**About the Paychex file:**
- Each person gets one line per job, pay type and rate, with hours added up for the whole pay run. Overtime and double time go on their own lines, with **OT** or **DT** after the job name.
- Anyone without a **Payroll ID**, or not marked Employee or Contractor, is **left out**. Before the file downloads you get a list of them with their hours and pay. Enter those people in Paychex by hand, or fix them in AOS and export again.
- If a Paychex pay code is missing in **Maintenance → Payroll Export**, the file isn't created and the message says what to fill in.

**Sync from Paychex** (admins): crew can update their own phone, email and address in Paychex, and new hires get their Payroll ID there. Click **🔄 Sync from Paychex** on the Payroll page to bring that into AOS.
- You get a preview first. Apart from clear new Payroll IDs (below), nothing changes until you click **Apply**. Untick anything you don't want.
- **Contact updates:** Paychex's phone, email or address replaces what AOS has. A blank in Paychex never wipes out an AOS value.
- **New Payroll IDs:** a new Paychex worker who matches one AOS person with no Payroll ID gets the ID on that existing record.
- **Linked from Paychex (automatic):** new Payroll IDs that are a **clear match** are filled in as soon as the preview loads, without waiting for **Apply**. The green **Linked from Paychex** line lists who. The other new Payroll IDs stay in the preview for you to tick. The Onboarding page uses the same rule. A match is clear only when all of these are true:
1. Paychex has **exactly one** worker who could be this person, and that worker already has a **Payroll ID**.
2. The match is on **email**, **phone**, the worker AOS sent to Paychex, or the **exact name** (nicknames count, like Mike / Michael). A "similar name" (a typo apart) never counts.
3. A match on **name only** must be a worker who is **active** in Paychex, and if both AOS and Paychex have an email or phone, at least one must agree.
4. The person has **no possible duplicates in AOS**. If they do, merge them first; the next check links them.
5. **No other AOS record**, including deleted ones, already has that Payroll ID.

Anything less certain is never linked automatically. It's shown for a person to decide. Every automatic link is logged with the record as it was before, so it can be undone.
- **New people:** Paychex workers with no match in AOS are added as new employees.
- **Payroll Name** always holds the name exactly as Paychex has it. The name shown everywhere else in AOS is the name the crew goes by, and the sync never changes it.
- **To check by hand:** W-2 vs 1099 differences and possible duplicates are listed but never changed. Fix those on the employee record, or in Paychex.
- **Status** follows Paychex: terminated in Paychex means **Terminated** in AOS; active or on hold means **Active**.
- Paychex workers who are active are read in full. Inactive and terminated ones are only used to keep Status in step and to give an AOS person their existing Payroll ID.

Time that's in a payroll run is locked on Timekeeping. To change it, the run must be **Void**ed first.

## Onboarding: new crew into Paychex {#onboarding}

**Who:** Admins.

**What it's for:** getting new crew set up in Paychex before payday. The page lists everyone on a confirmed crew assignment or a timesheet from 30 days back to 30 days ahead who has no **Payroll ID**. Without one they're left out of the Paychex file. People with hours are at the top.

- **Email / Phone:** type straight into the box; it saves when you click away. Blanks are outlined in red.
- **Employee / Contractor:** click to switch between W-2 and 1099.
- **AOS duplicates:** other AOS records that look like the same person (same email, same phone, or the same or a very similar name). **Merge** opens both side by side; pick the one to keep. Everything (crew assignments, timesheets, payroll entries) moves to it and the other record is deleted, with a backup kept. If the two records have different names, emails or phones, choose which one to keep under **Name to use**, **Email to use** and **Phone to use**; a blank is filled in from the other record automatically. **Not same** stops flagging that pair.
- **Paychex column:** everyone is looked up in Paychex as soon as the page opens. It says **Checking…** for about 30 seconds, then shows every Paychex worker who might be them, or **Not in Paychex**. Paychex has its own duplicates, so there can be more than one. **Use ID** puts that worker's Payroll ID on the AOS record, and the person drops off the list. Nothing in Paychex changes. **Check Paychex** and **Refresh** look everyone up again.
- **Linked from Paychex (automatic):** when the match is **clear**, the Payroll ID is filled in during the check with no click, the person drops off the list, and the green **Linked from Paychex** line at the top shows who. Sync from Paychex on the Payroll page uses the same rule. A match is clear only when all of these are true:
1. Paychex has **exactly one** worker who could be this person, and that worker already has a **Payroll ID**.
2. The match is on **email**, **phone**, the worker AOS sent to Paychex, or the **exact name** (nicknames count, like Mike / Michael). A "similar name" (a typo apart) never counts.
3. A match on **name only** must be a worker who is **active** in Paychex, and if both AOS and Paychex have an email or phone, at least one must agree.
4. The person has **no possible duplicates in AOS**. If they do, merge them first; the next check links them.
5. **No other AOS record**, including deleted ones, already has that Payroll ID.

Anything less certain is never linked automatically. It's shown for a person to decide. Every automatic link is logged with the record as it was before, so it can be undone.
- **Send to Paychex:** adds the person to Paychex, and Paychex emails them an invite to finish their own setup (SSN, address, tax forms, direct deposit). It needs an email, and it stays greyed out until that person's Paychex check is back. Check the name, email and Employee/Contractor in the confirm box first, because that's what Paychex gets. If Paychex already seems to have them, you're shown who and asked before anything is sent.
- **Send selected:** tick several people (the top box ticks everyone who can be sent) and send them together. Anyone Paychex may already have is skipped and listed afterwards, to check and send one at a time.
- After a send the row shows **Sent**. Once they finish onboarding and Paychex gives them a Payroll ID, click **Check Paychex** and **Use ID**.

## Health Check {#health}

**What it is:** AOS checks every job automatically for problems that would cause trouble later: missing times, crew who aren't set up properly, gaps in the rate card. You'll see the results in two places:

- The **Health Check** tab on the job lists every problem.
- A coloured strip at the top of **Timekeeping**, **Quotes** and **Invoices** shows the problems that affect that screen. Click **Review on Job →** to see them all.

**How serious is it?**

- **⛔ Blocker**: something is wrong that will give a wrong result. Fix it first. When you issue a quote or invoice with a blocker on the job, AOS asks you to confirm.
- **⚠ Warning**: probably a problem. Check it.
- **ℹ Info**: worth knowing; often nothing to do.

Each problem says what's wrong, what it affects (**Downstream**) and, where possible, has a **→ Fix** link to the right screen. If it says **An admin needs to fix this**, the fix is on a screen only admins can open; let an admin know.

### Setting up the job

| Check | Level | What it means and what to do |
|---|---|---|
| **No days defined on this job** | Blocker | Daily Requirements is empty. Add the job's days. |
| **No crew needs on [date]** | Warning | A day has no positions or quantities. Add the crew needed for that day. |
| **No start/end times on [date]** | Blocker if crew are assigned, otherwise Warning | The day has no times, so its schedule and sign-in sheet won't print and Add Crew from Job skips it. Set the times on Daily Requirements. |
| **No shifts defined on this job** | Warning | Fine if each day is one continuous call. If a day has separate calls, add them on the Shifts tab. |
| **Header dates don't match day rows** | Warning | The job's start/end dates disagree with its days. Fix whichever is wrong. |

### Planning the crew

| Check | Level | What it means and what to do |
|---|---|---|
| **Under-staffed: [date] · [specialty]** | Warning | Fewer people assigned than needed. Assign more crew on Assigned Crew. Open spots don't count. |
| **Timesheet has crew but Assigned Crew is empty** | Warning | People were added straight to Timekeeping without being planned. Plan the crew on Assigned Crew so the paperwork and Time Clock work. |
| **[n] assigned crew members have no shift** | Warning | The job has more than one shift and someone isn't on one. Their Timekeeping rows stay locked until a shift is set. |
| **[n] assigned crew not yet confirmed** | Info | The job is within two days and some crew haven't confirmed. Check they're coming, then tick Confirmed. |
| **[n] timesheet rows aren't on Assigned Crew** | Info | Someone worked who wasn't planned, usually a walk-up added on site. Nothing to do unless it's a mistake. |

### Recording time

| Check | Level | What it means and what to do |
|---|---|---|
| **No time entered: [n] people on [date]** | Warning | The day is over and these people still have no times. Enter their actual times, or mark them **No Show**. |
| **Missing Time Out on [date]** | Warning | Someone has a Time In with no Time Out. Enter the Time Out. |
| **[n] timesheet rows waiting for approval** | Warning | Time from past days hasn't been approved. Approve it on Timesheet Review. |
| **Time Clock punch not on the timesheet** | Blocker | Someone clocked in or out at the Time Clock, but the time didn't save. Enter it by hand on Timekeeping. |
| **[n] timesheet rows are missing a position, specialty or shift** | Warning | These rows are locked until they're filled in. Set them on Timekeeping. |
| **Missing specialty: [name] · [date]** | Blocker | An approved row has no specialty, so it can't be priced or paid correctly. Unlock it, set the specialty, approve again. |
| **Timesheet has rows on a date not on the job** | Warning | Usually a day copied to the wrong date. Fix the date, or add the day to Daily Requirements. |
| **Duplicate employee: [name]** | Warning | The same person appears under two employee records. Tell an admin so the records can be merged. |

A day counts as **over** at noon the next day, so overnight shifts aren't flagged while they're still running.

### Payroll

These show as soon as someone is put on the job, so they can be fixed before payday. A red note also appears next to the person's name on Assigned Crew and Timekeeping.

| Check | Level | What it means and what to do |
|---|---|---|
| **[n] people have no Payroll ID** | Warning | They'll be left out of the Paychex file. Add their Payroll ID on their employee record. |
| **[n] people aren't marked Employee or Contractor** | Warning | Paychex needs to know W-2 vs 1099. Set Employment Type on their employee record. |
| **[n] crew rows aren't linked to an employee** | Warning | Pick the person from the employee list on that row. Otherwise they're left out of the Paychex file. |
| **W-2 overtime has no Paychex pay component** | Warning | An admin needs to fill in the pay code in **Maintenance → Payroll Export**. Until then the Paychex file won't be created. |
| **No Paychex Company ID is set** | Warning | An admin needs to set it in **Maintenance → Payroll Export**. |

### Rates, quotes and invoices

These are usually for admins to fix.

| Check | Level | What it means |
|---|---|---|
| **No rate card resolves for this job** | Blocker | The job has no rate card, so nothing can be priced. |
| **Rate card missing specialty: [name]** | Blocker | The job needs a specialty that isn't on its rate card. |
| **Missing bill rate: [position] / [specialty]** | Blocker | The rate card row has no client rate, so those lines would bill at zero. |
| **Missing pay rate: [position] / [specialty]** | Warning | The rate card row has no pay rate. |
| **No OT/DT threshold: [position] / [specialty]** | Info | No overtime rule is set for that row. |
| **Uneven day/hourly ratio: [position] / [specialty]** | Info | The day rate doesn't divide evenly by the hourly rate, so the hours a day rate covers are rounded. |
| **Rate card has no holiday multiplier** | Info | Holiday days will use the default. |
| **Timesheet uses specialty not on rate card** | Blocker | Time was recorded under a specialty the rate card doesn't have. |
| **Job and quote reference different rate cards** | Warning | The quote was priced from a different rate card than the job's current one. |
| **Quote and invoice reference different rate cards** | Warning | The invoice may not match what the client was quoted. |
| **Quote covers [n] days but the job has [n]** | Warning | A day is missing from the quote, or the job has an extra day. |
| **Quote has a day rate on [date] but the day is set to Hourly** | Warning | Roles on the quote get the day rate, but anyone in a role the quote doesn't list is paid by the clock. Set the day's Rate to Day Rate on Daily Requirements. |
| **Quote has a day rate on [date] but the job has no day for it** | Warning | Payroll can't build a run that includes this date. Add the day on Daily Requirements and set its Rate to Day Rate. |
| **[n] approved days not yet on an invoice** | Warning | Approved work that hasn't been billed yet. |
| **Invoice [#] has zero-value lines** | Blocker | Some lines on an issued invoice came out at zero. Revise the invoice once the rate card is fixed. |

## Users (admins) {#users}

**What it's for:** giving people a login to AOS.

1. Go to **Maintenance** → **Users** and click **+ Add User**.
2. Enter their **Full Name**, **Email** and a starting **Password**.
3. Choose their **Role**: **Admin**, **Coordinator**, **Crew Leader** or **Payroll**.
4. Under **Link to Employee Record**, choose their entry in the employee directory. Crew leaders need this so their time is recorded against them.
5. Click **Create User**, and give them their email and password.

To change someone's role or reset their password, click **Edit** next to them. Leave the password blank to keep the current one.

### Payroll Export settings

**Maintenance → Payroll Export** holds what the Paychex file needs:
- **Paychex Company ID**
- **Job Name column**: what goes in Paychex's Job Name (the job's Event Abbr, its full Event Name, or blank)
- **Pay components**: the Paychex pay code for W-2 and 1099 regular, overtime and double-time hours. **Copy and paste these from Paychex.** They must match exactly, spaces included, or Paychex rejects the line.
