import { AppShell } from "@/components/layout/app-shell";
import Dashboard from "@/components/shared/dashboard";
export default function DashboardPage() {
  return (
    <AppShell title="Dashboard" subtitle="Operational overview — revenue, unpaid invoices, upcoming events, and crew pipeline.">
      <Dashboard />
    </AppShell>
  );
}
