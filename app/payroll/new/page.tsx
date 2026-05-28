import { AppShell } from "@/components/layout/app-shell";
import PayrollNewRun from "@/components/shared/payroll-new-run";

export default function Page() {
  return (
    <AppShell title="New Payroll Run" subtitle="Pick approved entries to include in this paydate.">
      <PayrollNewRun />
    </AppShell>
  );
}
