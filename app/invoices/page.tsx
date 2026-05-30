import { AppShell } from "@/components/layout/app-shell";
import InvoicesList from "@/components/shared/invoices-list";

export default function Page() {
  return (
    <AppShell title="Invoices" subtitle="All invoice drafts and issued documents.">
      <InvoicesList />
    </AppShell>
  );
}
