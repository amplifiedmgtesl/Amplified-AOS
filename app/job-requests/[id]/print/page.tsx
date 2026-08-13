import { Suspense } from "react";
import JobPrintPreview from "@/components/shared/job-print-preview";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  // Renders WITHOUT the AppShell — same as /quotes/[id]/pdf. The page is the
  // document, so nothing else may compete with it on screen or on paper.
  return (
    <Suspense fallback={<div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading…</div>}>
      <JobPrintPreview id={id} />
    </Suspense>
  );
}
