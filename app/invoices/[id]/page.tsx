import { AppShell } from "@/components/layout/app-shell";
import InvoiceDetail from "@/components/shared/invoice-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  return (
    <AppShell title="Invoice" subtitle="Read-only view of a frozen invoice.">
      <InvoiceDetail id={id} />
    </AppShell>
  );
}
