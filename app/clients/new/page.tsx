import { AppShell } from "@/components/layout/app-shell";
import ClientDetail from "@/components/shared/client-detail";

export default function Page() {
  return (
    <AppShell title="New Client" subtitle="Add a new client record.">
      <ClientDetail />
    </AppShell>
  );
}
