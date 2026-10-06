// Which section of HELP.md the Help button opens for a given page. Section
// ids are the `{#id}` anchors on HELP.md's headings. Order matters: the more
// specific path must come before the one it starts with.

const ROUTES: [RegExp, string][] = [
  [/^\/timekeeping\/review/, "review"],
  [/^\/(lead\/)?timekeeping/, "timekeeping"],
  [/^\/timeclock/, "timeclock"],
  [/^\/job-requests\/[^/]+\/print/, "printing"],
  [/^\/job-requests\/[^/]+\/pre-invoice-report/, "reports"],
  [/^\/(job-requests|lead\/jobs)\/?$/, "jobs-list"],
  [/^\/(job-requests|lead\/jobs)/, "jobs"],
  [/^\/dashboard/, "dashboard"],
  [/^\/master-calendar/, "calendar"],
  [/^\/clients/, "clients"],
  [/^\/(employee-directory|lead\/employees)/, "employees"],
  [/^\/maintenance/, "users"],
  [/^\/quotes/, "quotes"],
  [/^\/invoices/, "invoicing"],
  [/^\/payroll/, "payroll"],
  [/^\/job-costing/, "reports"],
];

// A job page's open tab (?tab=, kept in the address by job-detail) has its
// own section.
const JOB_TABS: Record<string, string> = {
  daily: "requirements",
  crew: "crew",
  shifts: "shifts",
  attachments: "attachments",
  health: "health",
};

export function helpSectionFor(pathname: string | null | undefined, search?: string | null): string {
  const p = pathname || "";
  for (const [re, id] of ROUTES) {
    if (!re.test(p)) continue;
    if (id === "jobs") {
      const tab = new URLSearchParams(search || "").get("tab");
      if (tab && JOB_TABS[tab]) return JOB_TABS[tab];
    }
    return id;
  }
  return "overview";
}

export function helpUrl(pathname: string | null | undefined, search?: string | null): string {
  return `/help#${helpSectionFor(pathname, search)}`;
}

// Named target: repeated clicks reuse one Help tab instead of stacking them.
export function openHelp(pathname: string | null | undefined, search?: string | null): void {
  window.open(helpUrl(pathname, search), "aos-help");
}
