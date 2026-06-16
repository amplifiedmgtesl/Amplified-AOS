import { AppShell } from "@/components/layout/app-shell";
import JobDetail from "@/components/shared/job-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  return (
    <AppShell title="Job" subtitle="View and edit a job record.">
      <JobDetail jobId={id} basePath="/job-requests" />
    </AppShell>
  );
}
