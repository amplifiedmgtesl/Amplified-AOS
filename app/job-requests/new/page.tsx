import { AppShell } from "@/components/layout/app-shell";
import JobDetail from "@/components/shared/job-detail";

export default function Page() {
  return (
    <AppShell title="New Job" subtitle="Create a new job record.">
      <JobDetail basePath="/job-requests" />
    </AppShell>
  );
}
