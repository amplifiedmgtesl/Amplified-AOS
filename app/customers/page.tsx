import { AppShell } from "@/components/layout/app-shell";
import CustomerMaintenance from "@/components/shared/customer-maintenance";

export default function CustomersPage() {
  return (
    <AppShell title="Customers" subtitle="Manage client records and merge duplicates">
      <CustomerMaintenance />
    </AppShell>
  );
}
