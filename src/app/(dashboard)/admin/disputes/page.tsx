import Link from "next/link";

import { listAdminDisputesAction } from "./actions";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata = { title: "Admin — Disputes" };

/** Module 21 — Disputes & Support: minimal admin dispute queue — list +
 *  search by case number/title. Filtering by status/priority is supported
 *  by the underlying action/use case; this page keeps the UI to the
 *  essentials (status column only) per this module's "functional, not
 *  polished" scope decision. */
export default async function AdminDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const { search, status } = await searchParams;
  const result = await listAdminDisputesAction({ search, status, limit: 50 });
  const disputes = result.success ? result.data : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Disputes" />
      <form className="flex gap-2">
        <input name="search" defaultValue={search} placeholder="Search case number or title" className="rounded-md border border-border px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm">
          Search
        </button>
      </form>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2">Case</th>
            <th>Title</th>
            <th>Status</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((d) => (
            <tr key={d.id} className="border-b border-border/50">
              <td className="py-2">
                <Link href={`/admin/disputes/${d.id}`} className="underline">
                  {d.caseNumber}
                </Link>
              </td>
              <td>{d.title}</td>
              <td>{d.status}</td>
              <td>{d.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {disputes.length === 0 && <p className="text-sm text-foreground/70">No disputes found.</p>}
    </div>
  );
}
