import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/dashboard/page-header";
import { getSupportTicketAction } from "../actions";

export async function generateMetadata() {
  const t = await getTranslations("customer.support");
  return { title: t("detail.metaTitle") };
}

export default async function SupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getSupportTicketAction(id);
  if (!result.success) {
    notFound();
  }
  const ticket = result.data;
  const [t, tStatus, tDisputes] = await Promise.all([
    getTranslations("customer.support"),
    getTranslations("enums.status"),
    getTranslations("customer.disputes"),
  ]);
  const statusLabel = tStatus.has(ticket.status as never)
    ? tStatus(ticket.status as never)
    : t.has(`status.${ticket.status}` as never)
      ? t(`status.${ticket.status}` as never)
      : ticket.status;
  const categoryLabel = t.has(`category.${ticket.category}` as never)
    ? t(`category.${ticket.category}` as never)
    : ticket.category;
  const priorityLabel = tDisputes.has(`priority.${ticket.priority}` as never)
    ? tDisputes(`priority.${ticket.priority}` as never)
    : ticket.priority;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={ticket.subject}
        subtitle={t("detail.subtitle", {
          ticketNumber: ticket.ticketNumber,
          status: statusLabel,
          category: categoryLabel,
          priority: priorityLabel,
        })}
        breadcrumbs={[{ label: t("metaTitle"), href: "/support-tickets" }, { label: ticket.subject }]}
      />
      <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
      {ticket.resolutionNote && (
        <section className="rounded-md border border-border bg-black/5 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase text-foreground/60">{t("detail.resolution")}</h2>
          <p className="text-sm">{ticket.resolutionNote}</p>
        </section>
      )}
    </div>
  );
}
