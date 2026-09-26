import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getAdminSupportTicketAction } from "../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { AdminSupportTicketActions } from "./admin-support-ticket-actions";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("supportTicketsPage.detail.metaTitle") }) };
}

export default async function AdminSupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getAdminSupportTicketAction(id);
  if (!result.success) {
    notFound();
  }
  const ticket = result.data;
  const t = await getTranslations("admin");
  const enumLabel = (group: string, value: string) =>
    t.has(`${group}.${value}` as never) ? t(`${group}.${value}` as never) : value;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={ticket.subject}
        subtitle={ticket.ticketNumber}
        breadcrumbs={[{ label: t("supportTicketsPage.title"), href: "/admin/support-tickets" }, { label: ticket.ticketNumber }]}
        actions={<StatusBadge status={ticket.status} />}
      />

      <ResponsiveGrid cols="2" gap="md" bordered aria-label={t("supportTicketsPage.detail.details")} className="sm:grid-cols-2">
        <div>
          <p className="text-foreground/60">{t("supportTicketsPage.detail.category")}</p>
          <p className="font-medium">{enumLabel("supportTicketsPage.category", ticket.category)}</p>
        </div>
        <div>
          <p className="text-foreground/60">{t("supportTicketsPage.detail.priority")}</p>
          <p className="font-medium">{enumLabel("priority", ticket.priority)}</p>
        </div>
      </ResponsiveGrid>

      <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
      {ticket.resolutionNote && (
        <Section title={t("supportTicketsPage.detail.resolution")} bordered className="bg-black/5">
          <p className="text-sm">{ticket.resolutionNote}</p>
        </Section>
      )}
      <AdminSupportTicketActions ticketId={ticket.id} status={ticket.status} />
    </div>
  );
}
