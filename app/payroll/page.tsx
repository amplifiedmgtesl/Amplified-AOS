import { AppShell } from "@/components/layout/app-shell";
import PayrollList from "@/components/shared/payroll-list";

export default function Page() {
  return (
    <AppShell title="Payroll" subtitle="Group approved timesheet entries into paydate runs.">
      <PayrollList />
    </AppShell>
  );
}
