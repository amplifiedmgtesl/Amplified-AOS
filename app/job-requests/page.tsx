import { AppShell } from "@/components/layout/app-shell";
import JobsList from "@/components/shared/jobs-list";

export default function Page() {
  return (
    <AppShell title="Jobs" subtitle="The master record for every event — from lead through completed.">
      <JobsList basePath="/job-requests" />
    </AppShell>
  );
}
