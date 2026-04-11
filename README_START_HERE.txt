AMPLIFIED OPERATIONS SUITE - FULL REBUILD

This rebuild focuses on a stable local app with:
- Google-style master calendar
- quote builder synced to rate card
- professional invoice PDF builder synced to quote + rate card
- national employee directory imported from your workbook
- one-click adding employees to specific job sheets
- job sheet creation from calendar events or manual jobs
- logo in every page header
- larger terms section and tighter print layout on PDFs

Imported workbook counts:
- Calendar rows: 586
- Employee directory rows: 2473

Main workflow:
1) Review imported calendar on /master-calendar
2) Add Event + Build Quote or build quotes directly
3) Save invoice draft from /quote-builder
4) Print invoices from /invoices
5) Create or select a job sheet on /job-sheets
6) Add employees from /employee-directory with one click

Run:
npm install
npm run dev
open http://localhost:3000/login


Fix applied: restored missing rate-card editor component.


New in this build:
- cleaner icon-based dashboard
- dedicated Timekeeping page linked to job sheets and invoice detail
- hover detail + delete controls on calendar events
- previous-data dropdowns when creating events
- event job-profile panel with notes, drawings, and linked job sheet creation
- detailed quotes and invoices with optional timekeeping summary and electronic signature
- editable employee profiles with notes, profile picture, and documents


Hotfixes in this package:
- Master Calendar hover detail now opens reliably with visible hover cards
- Clicking an event now opens a true popup Job Profile modal
- Event deletion now works from hover cards and the job profile popup
- Employee Directory delete now also hides imported employees correctly
