import Link from "next/link";
import { LifeBuoy } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/typography";
import { listMySupportTicketsAction } from "./actions";
import { NewSupportTicketForm } from "./new-support-ticket-form";

export const metadata = { title: "Support tickets" };

export default async function SupportTicketsPage() {
  const result = await listMySupportTicketsAction({ limit: 50 });
  const tickets = result.success ? result.data : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
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
                <Link href={`/support-tickets/${t.id}`} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <Card className="flex items-center justify-between gap-4 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span> — {t.subject}
                    </span>
                    <StatusBadge status={t.status} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
