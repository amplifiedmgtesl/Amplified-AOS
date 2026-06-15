import { AppShell } from "@/components/layout/app-shell";
import EmployeeProfile from "@/components/shared/employee-profile";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  return (
    <AppShell title="Employee Profile" subtitle="View and edit a crew member's record.">
      <EmployeeProfile employeeKey={key} basePath="/employee-directory" />
    </AppShell>
  );
}
