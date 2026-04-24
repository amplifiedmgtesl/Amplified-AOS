import { AppShell } from "@/components/layout/app-shell";
import TimesheetReview from "@/components/shared/timesheet-review";

export default function Page() {
  return (
    <AppShell title="Timesheet Review" subtitle="Approve or reject submitted timesheet entries across all jobs.">
      <TimesheetReview />
    </AppShell>
  );
}
