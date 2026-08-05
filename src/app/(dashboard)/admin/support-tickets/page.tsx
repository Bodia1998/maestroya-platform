import Link from "next/link";

import { listAdminSupportTicketsAction } from "./actions";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata = { title: "Admin — Support tickets" };

export default async function AdminSupportTicketsPage() {
  const result = await listAdminSupportTicketsAction({ limit: 50 });
  const tickets = result.success ? result.data : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Support tickets" />
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
