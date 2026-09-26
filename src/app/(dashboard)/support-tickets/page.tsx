import { LifeBuoy } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/typography";
import { PageContainer } from "@/components/layout/page-container";
import { listMySupportTicketsAction } from "./actions";
import { NewSupportTicketForm } from "./new-support-ticket-form";

export async function generateMetadata() {
  const t = await getTranslations("customer.support");
  return { title: t("metaTitle") };
}

export default async function SupportTicketsPage() {
  const result = await listMySupportTicketsAction({ limit: 50 });
  const tickets = result.success ? result.data : [];
  const t = await getTranslations("customer.support");
  const statusLabel = (status: string): string | undefined =>
    t.has(`status.${status}` as never) ? t(`status.${status}` as never) : undefined;

  return (
    <PageContainer>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <NewSupportTicketForm />

      <section className="flex flex-col gap-3">
        <Heading as="h2" level="h6">
          {t("myTickets")}
        </Heading>
        {tickets.length === 0 ? (
          <EmptyState icon={LifeBuoy} title={t("empty.title")} description={t("empty.description")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <LinkCard href={`/support-tickets/${ticket.id}`} cardClassName="flex items-center justify-between gap-4 p-3">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span> — {ticket.subject}
                  </span>
                  <StatusBadge status={ticket.status} label={statusLabel(ticket.status)} />
                </LinkCard>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
