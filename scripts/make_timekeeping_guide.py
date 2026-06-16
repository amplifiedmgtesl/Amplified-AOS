# Generates the Crew Lead / Admin timekeeping guide PDF.
# Run: python scripts/make_timekeeping_guide.py
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem,
    Table, TableStyle, HRFlowable, KeepTogether,
)

OUT = "docs/timekeeping-crew-lead-guide.pdf"

GOLD = colors.HexColor("#8a6d1a")
GOLD_DK = colors.HexColor("#6b5214")
DARK = colors.HexColor("#2b2118")
CREAM = colors.HexColor("#f7f4ee")
LINE = colors.HexColor("#d9cdb5")
BLUE = colors.HexColor("#1d4ed8")
GREEN = colors.HexColor("#1a5a1a")
GREENBG = colors.HexColor("#e8f7e8")
AMBERBG = colors.HexColor("#fff7e0")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Heading1"], textColor=DARK, fontSize=18, spaceBefore=16, spaceAfter=6)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], textColor=GOLD_DK, fontSize=13.5, spaceBefore=14, spaceAfter=4)
BODY = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10.5, leading=15, spaceAfter=6)
SMALL = ParagraphStyle("Small", parent=styles["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#555"))
TITLE = ParagraphStyle("Title", parent=styles["Title"], textColor=DARK, fontSize=24, spaceAfter=2)
SUB = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=12, textColor=GOLD_DK, spaceAfter=2)
BULLET = ParagraphStyle("Bullet", parent=BODY, spaceAfter=3)
NOTE = ParagraphStyle("Note", parent=BODY, fontSize=10, leading=14, textColor=DARK)


def bullets(items, style=BULLET):
    return ListFlowable(
        [ListItem(Paragraph(t, style), leftIndent=10, value="•") for t in items],
        bulletType="bullet", start="•", leftIndent=14, bulletFontSize=9,
    )


def callout(title, body_items, bg, border, title_color):
    inner = [Paragraph(f"<b>{title}</b>", ParagraphStyle("ct", parent=BODY, textColor=title_color, fontSize=11, spaceAfter=4))]
    inner.append(bullets(body_items))
    t = Table([[inner]], colWidths=[6.7 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t


def section_rule():
    return HRFlowable(width="100%", thickness=1, color=LINE, spaceBefore=6, spaceAfter=10)


story = []

# ─── Header ───────────────────────────────────────────────────────────────
hdr = Table([[
    Paragraph("AMPLIFIED EVENT SOLUTIONS", ParagraphStyle("brand", parent=BODY, textColor=GOLD, fontSize=11, spaceAfter=0)),
]], colWidths=[6.7 * inch])
story.append(hdr)
story.append(Paragraph("Timekeeping Guide", TITLE))
story.append(Paragraph("For Crew Leads &amp; Admins", SUB))
story.append(Paragraph("How crew scheduling, time entry, and approval fit together after the V2 update.", SMALL))
story.append(section_rule())

# ─── 1. Big picture ───────────────────────────────────────────────────────
story.append(Paragraph("1. The big picture", H1))
story.append(Paragraph(
    "Timekeeping now connects three things that used to be separate: the <b>job</b> (and its quote/rate card), "
    "the <b>crew assignments</b> for each day, and the <b>actual hours</b> worked. The crew lead builds the day's "
    "roster in the Timekeeping screen; crew members can fill in their own actual time from the Staff App; and the "
    "crew lead/admin approves it. Because each entry is linked to the job, the correct <b>bill rates are pulled "
    "automatically from the job's quote</b> — so an entry arrives fully priced and an approver only needs to confirm it.",
    BODY))
story.append(bullets([
    "<b>One timesheet per job.</b> Every crew member's daily rows live on that job's timekeeping sheet.",
    "<b>Rates are automatic.</b> Bill rates (and OT/DT thresholds, holiday multiplier) come from the job's most recent quote — no one types them in.",
    "<b>The Staff App and the Timekeeping screen share the same data.</b> A change in one shows up in the other.",
]))

# ─── 2. The flow ──────────────────────────────────────────────────────────
story.append(Paragraph("2. The end-to-end flow", H1))
flow = [
    ("Build the day", "Crew lead adds the crew for each day on the Timekeeping screen (Add Crew from Job, or + Add Crew Member)."),
    ("Print the sign-in sheet", "Print / export the day's timesheet as the physical sign-in sheet for the job site."),
    ("Capture actual time", "Either the crew member enters their own actual time in the Staff App, or the crew lead types it on the Timekeeping screen."),
    ("Crew marks done", "In the Staff App, the crew member checks “I'm done” when their time is final (optional but helpful)."),
    ("Review &amp; approve", "Crew lead/admin reviews each row and approves. Approval locks the row."),
    ("Flows to payroll", "Approved hours feed the labor summaries used by invoices and payroll."),
]
data = [[Paragraph(f"<b>{i+1}</b>", ParagraphStyle("n", parent=BODY, textColor=colors.white, alignment=1)),
         Paragraph(f"<b>{t}</b>", BODY), Paragraph(d, BODY)] for i, (t, d) in enumerate(flow)]
tbl = Table(data, colWidths=[0.4 * inch, 1.6 * inch, 4.7 * inch])
tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, -1), GOLD),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ("LEFTPADDING", (1, 0), (-1, -1), 8),
]))
story.append(tbl)

# ─── 3. Crew lead: building the day ───────────────────────────────────────
story.append(Paragraph("3. Crew Lead — building the day", H1))
story.append(Paragraph("On the Timekeeping screen, pick the Job, then add crew with either button:", BODY))
story.append(bullets([
    "<b>Add Crew from Job</b> — pulls everyone already assigned to the job's days, each pre-filled with their date, shift, position and specialty. Best for a planned roster.",
    "<b>+ Add Crew Member</b> — add one person on the spot. Pick the <b>work date</b> in the dialog (it defaults to the day you have open), then the person. The row lands on that day.",
])),
story.append(Paragraph(
    "Each added row is a <b>planned record</b>: it sits on the job's timesheet ready for actual times. "
    "Use <b>Print / Export</b> to produce the physical sign-in sheet, and <b>Hide Bill Columns</b> when sharing a "
    "view with someone who shouldn't see billing.", BODY))

# ─── 4. Crew member: staff app ────────────────────────────────────────────
story.append(Paragraph("4. Crew Member — entering time in the Staff App", H1))
story.append(bullets([
    "<b>Shifts needing your time</b> on the home/Timesheets screen lists the planned shifts that still need actual time.",
    "Tapping <b>Enter time</b> opens the entry: pick the real Time In/Out (a split shift has a second pair), meal breaks, and confirm position/specialty/shift.",
    "If reassigned on-site, the crew member can change position/specialty/shift, or add a separate entry for the extra role.",
    "When finished, they check <b>“I'm done”</b>. This is an advisory signal to the crew lead — it does <b>not</b> lock the entry; it can still be edited until approved.",
]))
story.append(Paragraph(
    "Crew don't see billing dollars — only their hours. Rates and totals are computed behind the scenes from the job's quote.", SMALL))

# ─── 5. Review & approve ──────────────────────────────────────────────────
story.append(Paragraph("5. Reviewing &amp; approving", H1))
story.append(bullets([
    "Staff-submitted entries that aren't yet on the sheet appear in a <b>“Staff Submissions Pending Review”</b> card at the bottom of the job's Timekeeping screen — with Approve / Reject buttons.",
    "Entries already on the sheet that a crew member finalized show a green <b>“Staff done”</b> marker; the day header shows a <b>“staff-finalized” count</b>.",
    "Use the <b>“Staff time” filter</b> (All / Awaiting staff / Staff done) to narrow the grid to who still hasn't finalized.",
    "Approving attaches the entry to the job's timesheet and <b>locks it</b>. To change an approved entry, unlock it (set back to submitted) first.",
]))

# ─── 6. Rules to know ─────────────────────────────────────────────────────
story.append(Paragraph("6. Rules worth knowing", H1))
story.append(callout(
    "Required to approve",
    [
        "<b>Shift</b> is required to approve when the job has shifts defined (payroll groups daily rules by shift).",
        "<b>Specialty</b> is required to approve when the position has specialties (payroll resolves the pay rate by specialty).",
        "These are checked at <b>approval</b> time, not when the row is created. The Staff App asks for them up front, so staff submissions arrive complete.",
    ],
    AMBERBG, GOLD, GOLD_DK))
story.append(Spacer(1, 8))
story.append(callout(
    "Pricing &amp; locking",
    [
        "Bill rates, OT/DT thresholds and the holiday multiplier are snapshotted from the job's <b>most recent quote</b> — the same source the invoice uses.",
        "“I'm done” (staff finalized) is advisory and never locks an entry. Only <b>approval</b> locks it.",
        "An approved entry that's been pulled onto an invoice is double-locked until the invoice line is unlinked.",
    ],
    GREENBG, GREEN, GREEN))

# ─── 7. Proposed roadmap ──────────────────────────────────────────────────
story.append(Paragraph("7. Proposed roadmap (not yet built)", H1))
story.append(Paragraph(
    "Sections 1–6 are live today. The items below are proposed and sequenced. Phase 1 closes the loop with crew "
    "and is well defined. Phase 2 (QR / on-site clock-in) still needs design before it's workable.", NOTE))

story.append(Paragraph("Phase 1 (next) — close the loop with crew", H2))
story.append(Paragraph("<b>Assignment notifications + auto login</b>", BODY))
story.append(bullets([
    "When a crew member is <b>confirmed</b> for a job (or a timekeeping row is added for them), send an <b>email and/or SMS</b> with the assignment (job, date, call time, role).",
    "The message includes a <b>link to the Staff App</b> and their <b>username</b>.",
    "If they don't yet have a Staff App login, <b>create one automatically</b> and include the password in the message.",
    "Result: the crew member opens the app, sees the shift under “needing your time,” and enters their hours — the loop is closed end to end.",
]))
story.append(Paragraph("<b>Spreadsheet crew load</b>", BODY))
story.append(bullets([
    "Load crew assignments for a job from a <b>spreadsheet</b>. On confirmation, anyone without a login gets an account created and the same assignment notification.",
    "When the job starts, they enter their time in the Staff App like everyone else.",
]))

story.append(Paragraph("Phase 2 (needs design) — QR / on-site clock-in", H2))
story.append(Paragraph(
    "Connor asked about a <b>QR-code clock-in/out</b> on job sites feeding straight into timekeeping. It's a good goal "
    "(fast, objective, real-time capture), but a bare QR code can't stand on its own — it needs to be spec'd out "
    "first. The open questions:", BODY))
story.append(bullets([
    "<b>Who scanned?</b> A single shared QR can't identify the person — so it still needs a login / per-employee identity. That largely lands back on the Staff App.",
    "<b>Which record?</b> A QR doesn't know which job / day / shift / row to open, or <b>whether this scan is a clock-in or a clock-out</b> — it has to map to the right planned timekeeping entry and track in-vs-out state per person per shift.",
    "<b>Keep the structure.</b> Punches must still resolve position / specialty / shift and route through <b>approval</b> — they should feed the existing entry, not bypass it (or billing/payroll accuracy is lost).",
    "<b>Hardware?</b> A shared site kiosk vs. each person's own phone changes the whole design.",
]))
story.append(Paragraph(
    "<b>Likely workable shape:</b> the QR becomes a <b>deep link</b> that opens the correct shift's clock-in screen in "
    "the Staff App — identity from the person's login, one tap to stamp in/out, feeding the same structured entry and "
    "approval we already have. That keeps the convenience of “scan to clock in” without a separate, blind timestamp "
    "system. To be designed and confirmed before any build.", BODY))

story.append(Spacer(1, 14))
story.append(HRFlowable(width="100%", thickness=0.5, color=LINE, spaceAfter=6))
story.append(Paragraph(
    "Sections 1–6 describe the system as built today. Section 7 is proposed and subject to change.", SMALL))

doc = SimpleDocTemplate(OUT, pagesize=letter, topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                        leftMargin=0.9 * inch, rightMargin=0.9 * inch,
                        title="Amplified Timekeeping Guide", author="Amplified Event Solutions")
doc.build(story)
print("wrote", OUT)
