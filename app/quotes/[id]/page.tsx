import { AppShell } from "@/components/layout/app-shell";
import QuoteDetail from "@/components/shared/quote-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell title="Quote" subtitle="Read-only view of a frozen quote.">
      <QuoteDetail id={id} />
    </AppShell>
  );
}
