import { AppShell } from "@/components/layout/app-shell";
import { UserManagement } from "@/components/shared/user-management";

export default function UserManagementPage() {
  return (
    <AppShell
      title="User Management"
      subtitle="Manage application users and their access levels"
    >
      <UserManagement />
    </AppShell>
  );
}
