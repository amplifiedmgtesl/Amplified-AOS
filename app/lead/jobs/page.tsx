import JobsList from "@/components/shared/jobs-list";

export const metadata = { title: "Jobs — Crew Leader" };

export default function LeadJobsPage() {
  // JobsList + JobDetail read the user's role (useUserRole) and hide quote
  // buttons, the rate-card pin, and Delete for crew leaders. No bill/pay
  // dollar amounts exist anywhere on this screen.
  return <JobsList basePath="/lead/jobs" />;
}
