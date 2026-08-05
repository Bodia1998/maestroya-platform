import { LifeBuoy } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/typography";
import { PageContainer } from "@/components/layout/page-container";
import { listMySupportTicketsAction } from "./actions";
import { NewSupportTicketForm } from "./new-support-ticket-form";

export const metadata = { title: "Support tickets" };

export default async function SupportTicketsPage() {
  const result = await listMySupportTicketsAction({ limit: 50 });
  const tickets = result.success ? result.data : [];

  return (
    <PageContainer>
      <PageHeader title="Support" subtitle="Account problems, verification issues, bugs, or general questions." />

      <NewSupportTicketForm />

      <section className="flex flex-col gap-3">
        <Heading as="h2" level="h6">
          My tickets
        </Heading>
        {tickets.length === 0 ? (
          <EmptyState icon={LifeBuoy} title="No support tickets" description="You haven't opened any support tickets." />
        ) : (
          <ul className="flex flex-col gap-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <LinkCard href={`/support-tickets/${t.id}`} cardClassName="flex items-center justify-between gap-4 p-3">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span> — {t.subject}
                  </span>
                  <StatusBadge status={t.status} />
                </LinkCard>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
