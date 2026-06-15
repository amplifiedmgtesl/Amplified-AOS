import JobDetail from "@/components/shared/job-detail";

export const metadata = { title: "Job — Crew Leader" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  return <JobDetail jobId={id} basePath="/lead/jobs" />;
}
