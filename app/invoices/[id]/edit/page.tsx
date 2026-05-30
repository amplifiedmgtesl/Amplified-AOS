import { AppShell } from "@/components/layout/app-shell";
import InvoiceDraftEditor from "@/components/shared/invoice-draft-editor";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  return (
    <AppShell title="Edit Invoice Draft" subtitle="In-progress draft. Save to keep working, Issue to freeze.">
      <InvoiceDraftEditor id={id} />
    </AppShell>
  );
}
