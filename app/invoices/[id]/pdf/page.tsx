// Placeholder: invoice PDF view ships in a follow-up commit. Until then,
// this route just bounces back to the detail page so the button doesn't 404.
import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/invoices/${id}`);
}
