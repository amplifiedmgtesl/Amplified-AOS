import InvoicePdfView from "@/components/shared/invoice-pdf-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Renders without AppShell — clean page for printing.
  return <InvoicePdfView id={id} />;
}
