import PreInvoiceReportView from "@/components/shared/pre-invoice-report-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  // Renders without AppShell — clean page for printing.
  return <PreInvoiceReportView jobId={id} />;
}
