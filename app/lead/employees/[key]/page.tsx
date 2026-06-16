import EmployeeProfile from "@/components/shared/employee-profile";

export const metadata = { title: "Employee Profile — Crew Leader" };

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  // hideBill strips pay-rate override + pay metrics so crew leaders never see
  // billing/pay figures. basePath keeps the back link inside the lead app.
  return <EmployeeProfile employeeKey={key} basePath="/lead/employees" hideBill />;
}
