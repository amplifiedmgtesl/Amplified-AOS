import { AppShell } from "@/components/layout/app-shell";
import ClientMaintenance from "@/components/shared/client-maintenance";

export default function ClientsPage() {
  return (
    <AppShell title="Clients" subtitle="Manage client records and merge duplicates">
      <ClientMaintenance />
    </AppShell>
  );
}
