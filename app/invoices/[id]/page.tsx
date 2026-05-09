import { AppShell } from "@/components/layout/app-shell";
import InvoiceDetail from "@/components/shared/invoice-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell title="Invoice" subtitle="Read-only view of a frozen invoice.">
      <InvoiceDetail id={id} />
    </AppShell>
  );
}
