import { AppShell } from "@/components/layout/app-shell";
import QuoteDetail from "@/components/shared/quote-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  // Decode in case legacy slug-PK ids contain spaces/commas that arrived URL-encoded.
  const id = decodeURIComponent(raw);
  return (
    <AppShell title="Quote" subtitle="Read-only view of a frozen quote.">
      <QuoteDetail id={id} />
    </AppShell>
  );
}
