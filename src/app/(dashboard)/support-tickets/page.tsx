import Link from "next/link";

import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
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

      <section>
        <h2 className="mb-2 text-lg font-medium">My tickets</h2>
        {tickets.length === 0 ? (
          <EmptyState title="No support tickets" description="You haven't opened any support tickets." />
        ) : (
          <ul className="flex flex-col gap-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/support-tickets/${t.id}`} className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-black/5">
                  <span>
                    <span className="font-mono text-xs text-foreground/60">{t.ticketNumber}</span> — {t.subject}
                  </span>
                  <span className="text-xs">{t.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
