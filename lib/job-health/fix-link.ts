// Where a finding's "→ Fix" link should go for the person looking at it.
// Findings are shown to every role (they never carry dollar amounts), but a
// fix on an admin-only screen is a dead end for anyone else — the shell just
// bounces them. Crew leaders have their own /lead/* copies of shared screens.

const ADMIN_ONLY = [/^\/rate-card/, /^\/invoices/, /^\/quotes/];

export type FixLink = { href: string } | { adminOnly: true } | null;

export function fixLinkFor(href: string | undefined, role: string | null | undefined): FixLink {
  if (!href) return null;
  if (role === "admin") return { href };
  if (ADMIN_ONLY.some((re) => re.test(href))) return { adminOnly: true };
  if (role !== "crew_leader") return { href };
  if (href.startsWith("/timekeeping")) return { href: "/lead/timekeeping" };
  if (href.startsWith("/employee-directory")) return { href: href.replace("/employee-directory", "/lead/employees") };
  const job = href.match(/^\/job-requests\/([^/?#]+)(.*)$/);
  if (job) return { href: `/lead/jobs/${job[1]}${job[2]}` };
  const list = href.match(/^\/job-requests\?(.*)$/);
  if (list) {
    const q = new URLSearchParams(list[1]);
    const id = q.get("id");
    if (id) { q.delete("id"); const rest = q.toString(); return { href: `/lead/jobs/${encodeURIComponent(id)}${rest ? `?${rest}` : ""}` }; }
  }
  return { href };
}
