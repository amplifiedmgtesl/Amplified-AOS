import { AppShell } from "@/components/layout/app-shell";
import InvoiceBuilder from "@/components/shared/invoice-builder";

// Legacy invoice builder — kept accessible during the Phase C transition.
// New invoice flow is at /invoices. Once the new flow is fully proven, this
// route + component will be retired (planned cleanup pass).
export default function Page() {
  return (
    <AppShell
      title="Invoice Builder (legacy)"
      subtitle="Pre-rewrite invoice flow. Use /invoices for the new path."
    >
      <InvoiceBuilder />
    </AppShell>
  );
}
