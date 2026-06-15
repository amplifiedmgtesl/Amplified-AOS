import EmployeeDirectory from "@/components/shared/employee-directory";

export const metadata = { title: "Employees — Crew Leader" };

export default function LeadEmployeesPage() {
  // hideBill strips Total Bill metrics + columns so the directory is safe to
  // surface in the crew_leader workflow (e.g. when picking crew on the
  // Assigned Crew tab). Crew leaders should never see billing rates.
  return <EmployeeDirectory hideBill basePath="/lead/employees" />;
}
