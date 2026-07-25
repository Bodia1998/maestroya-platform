import Link from "next/link";

import { listMySupportTicketsAction } from "./actions";
import { NewSupportTicketForm } from "./new-support-ticket-form";

export const metadata = { title: "Support tickets" };

export default async function SupportTicketsPage() {
  const result = await listMySupportTicketsAction({ limit: 50 });
  const tickets = result.success ? result.data : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Support</h1>
        <p className="mt-1 text-sm text-foreground/70">Account problems, verification issues, bugs, or general questions.</p>
      </div>

      <NewSupportTicketForm />

      <section>
        <h2 className="mb-2 text-lg font-medium">My tickets</h2>
        {tickets.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-foreground/70">
            You haven&apos;t opened any support tickets.
          </p>
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
