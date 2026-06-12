import JobRequests from "@/components/shared/job-requests";

export const metadata = { title: "Jobs — Crew Leader" };

export default function LeadJobsPage() {
  // The shared component reads the user's role itself (useUserRole) and
  // hides quote buttons, the rate-card pin, and Delete for crew leaders.
  // No bill/pay dollar amounts exist anywhere on this screen.
  return <JobRequests />;
}
