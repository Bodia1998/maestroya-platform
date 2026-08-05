import { notFound } from "next/navigation";

import { getAdminSupportTicketAction } from "../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
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
        actions={<StatusBadge status={ticket.status} />}
      />

      <ResponsiveGrid cols="2" gap="md" bordered aria-label="Ticket details" className="sm:grid-cols-2">
        <div>
          <p className="text-foreground/60">Category</p>
          <p className="font-medium">{ticket.category}</p>
        </div>
        <div>
          <p className="text-foreground/60">Priority</p>
          <p className="font-medium">{ticket.priority}</p>
        </div>
      </ResponsiveGrid>

      <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
      {ticket.resolutionNote && (
        <Section title="Resolution" bordered className="bg-black/5">
          <p className="text-sm">{ticket.resolutionNote}</p>
        </Section>
      )}
      <AdminSupportTicketActions ticketId={ticket.id} status={ticket.status} />
    </div>
  );
}
