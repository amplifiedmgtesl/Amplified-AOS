import QuotePdfView from "@/components/shared/quote-pdf-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  // Renders without the AppShell — we want a clean page for printing.
  return <QuotePdfView id={id} />;
}
