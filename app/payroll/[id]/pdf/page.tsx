import PayrollPdfView from "@/components/shared/payroll-pdf-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Renders without AppShell — clean page for printing, mirrors the
  // /quotes/[id]/pdf and /invoices/[id]/pdf preview flow.
  return <PayrollPdfView id={id} />;
}
