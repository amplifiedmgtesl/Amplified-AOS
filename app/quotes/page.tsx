import { AppShell } from "@/components/layout/app-shell";
import QuotesList from "@/components/shared/quotes-list";

export default function Page() {
  return (
    <AppShell title="Quotes" subtitle="All quote drafts and issued documents.">
      <QuotesList />
    </AppShell>
  );
}
