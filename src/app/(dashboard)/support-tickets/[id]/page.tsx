import { notFound } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { getSupportTicketAction } from "../actions";

export const metadata = { title: "Support ticket" };

export default async function SupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getSupportTicketAction(id);
  if (!result.success) {
    notFound();
  }
  const ticket = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.ticketNumber} · Status: ${ticket.status} · Category: ${ticket.category} · Priority: ${ticket.priority}`}
        breadcrumbs={[{ label: "Support tickets", href: "/support-tickets" }, { label: ticket.subject }]}
      />
      <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
      {ticket.resolutionNote && (
        <section className="rounded-md border border-border bg-black/5 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase text-foreground/60">Resolution</h2>
          <p className="text-sm">{ticket.resolutionNote}</p>
        </section>
      )}
    </div>
  );
}
