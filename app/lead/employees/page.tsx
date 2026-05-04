import EmployeeDirectory from "@/components/shared/employee-directory";

export const metadata = { title: "Employees — Crew Leader" };

export default function LeadEmployeesPage() {
  // hidePay strips Total Pay metrics + columns so the directory is safe to
  // surface in the crew_leader workflow (e.g. when picking crew on the
  // Assigned Crew tab).
  return <EmployeeDirectory hidePay />;
}
