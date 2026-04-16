import { AppShell } from "@/components/layout/app-shell";
import PositionMaintenance from "@/components/shared/position-maintenance";

export const metadata = { title: "Position Maintenance" };

export default function PositionMaintenancePage() {
  return (
    <AppShell title="Position Maintenance" subtitle="Manage the position list used across timekeeping, job sheets, and job costing">
      <PositionMaintenance />
    </AppShell>
  );
}
