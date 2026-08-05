import Link from "next/link";

import { makeListAdminAuditLogsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata = { title: "Admin — Audit log" };

type SearchParams = Promise<{ page?: string }>;

/** Admin Panel module (Module 16): read-only, paginated view of the
 *  append-only admin audit trail (see AdminAuditLogRepository). No edit or
 *  delete action exists anywhere in this module for these records. */
export default async function AdminAuditLogsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const logs = await makeListAdminAuditLogsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit log" subtitle="Append-only record of sensitive admin actions." />

      {logs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No audit log entries yet.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">When</th>
              <th className="py-2 pr-4">Admin</th>
              <th className="py-2 pr-4">Action</th>
              <th className="py-2 pr-4">Target</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{log.createdAt.toLocaleString()}</td>
                <td className="py-2 pr-4 font-mono text-xs">{log.adminUserId ?? "system"}</td>
                <td className="py-2 pr-4">{log.action}</td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {log.targetType}
                  {log.targetId ? `/${log.targetId}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/admin/audit-logs?page=${page - 1}`}>← Previous</Link> : <span />}
        {logs.length === DEFAULT_PAGE_SIZE && <Link href={`/admin/audit-logs?page=${page + 1}`}>Next →</Link>}
      </div>
    </div>
  );
}
