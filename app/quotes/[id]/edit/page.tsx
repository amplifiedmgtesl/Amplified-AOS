import { AppShell } from "@/components/layout/app-shell";
import QuoteDraftEditor from "@/components/shared/quote-draft-editor";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  return (
    <AppShell title="Edit Quote Draft" subtitle="In-progress draft. Save to keep working, Issue to freeze.">
      <QuoteDraftEditor id={id} />
    </AppShell>
  );
}
