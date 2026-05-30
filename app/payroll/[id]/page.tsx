import { AppShell } from "@/components/layout/app-shell";
import PayrollRunDetail from "@/components/shared/payroll-run-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell title="Payroll Run" subtitle="Review and finalize a payroll run.">
      <PayrollRunDetail runId={id} />
    </AppShell>
  );
}
