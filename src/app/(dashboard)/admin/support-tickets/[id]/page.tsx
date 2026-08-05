import { notFound } from "next/navigation";

import { getAdminSupportTicketAction } from "../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminSupportTicketActions } from "./admin-support-ticket-actions";

export const metadata = { title: "Admin — Support ticket" };

export default async function AdminSupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getAdminSupportTicketAction(id);
  if (!result.success) {
    notFound();
  }
  const ticket = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={ticket.subject}
        subtitle={ticket.ticketNumber}
        breadcrumbs={[{ label: "Support tickets", href: "/admin/support-tickets" }, { label: ticket.ticketNumber }]}
        actions={
          <div className="flex gap-3 text-xs text-foreground/70">
            <span>Status: {ticket.status}</span>
            <span>Category: {ticket.category}</span>
            <span>Priority: {ticket.priority}</span>
          </div>
        }
      />
      <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
      {ticket.resolutionNote && (
        <section className="rounded-md border border-border bg-black/5 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase text-foreground/60">Resolution</h2>
          <p className="text-sm">{ticket.resolutionNote}</p>
        </section>
      )}
      <AdminSupportTicketActions ticketId={ticket.id} status={ticket.status} />
    </div>
  );
}
