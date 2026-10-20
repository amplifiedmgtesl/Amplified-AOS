import { AppShell } from "@/components/layout/app-shell";
import Onboarding from "@/components/shared/onboarding";

export default function Page() {
  return (
    <AppShell title="Onboarding" subtitle="Crew on jobs without a Payroll ID.">
      <Onboarding />
    </AppShell>
  );
}
