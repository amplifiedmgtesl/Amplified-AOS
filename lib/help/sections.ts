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

export function helpSectionFor(pathname: string | null | undefined): string {
  const p = pathname || "";
  for (const [re, id] of ROUTES) if (re.test(p)) return id;
  return "overview";
}

export function helpUrl(pathname: string | null | undefined): string {
  return `/help#${helpSectionFor(pathname)}`;
}

// Named target: repeated clicks reuse one Help tab instead of stacking them.
export function openHelp(pathname: string | null | undefined): void {
  window.open(helpUrl(pathname), "aos-help");
}
