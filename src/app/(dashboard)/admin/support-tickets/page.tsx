import Link from "next/link";

import { listAdminSupportTicketsAction } from "./actions";

export const metadata = { title: "Admin — Support tickets" };

export default async function AdminSupportTicketsPage() {
  const result = await listAdminSupportTicketsAction({ limit: 50 });
  const tickets = result.success ? result.data : [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Support tickets</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2">Ticket</th>
            <th>Subject</th>
            <th>Category</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className="border-b border-border/50">
              <td className="py-2">
                <Link href={`/admin/support-tickets/${t.id}`} className="underline">
                  {t.ticketNumber}
                </Link>
              </td>
              <td>{t.subject}</td>
              <td>{t.category}</td>
              <td>{t.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tickets.length === 0 && <p className="text-sm text-foreground/70">No tickets found.</p>}
    </div>
  );
}
