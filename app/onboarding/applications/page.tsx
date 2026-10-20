import { AppShell } from "@/components/layout/app-shell";
import ApplicationsLoad from "@/components/shared/applications-load";

export default function Page() {
  return (
    <AppShell title="Load website applications" subtitle="One-time load of the Employee Application CSV from JotForm.">
      <ApplicationsLoad />
    </AppShell>
  );
}
