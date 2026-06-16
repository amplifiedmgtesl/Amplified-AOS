import { AppShell } from "@/components/layout/app-shell";
import ClientDetail from "@/components/shared/client-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  return (
    <AppShell title="Client" subtitle="View and edit a client record.">
      <ClientDetail clientId={id} />
    </AppShell>
  );
}
