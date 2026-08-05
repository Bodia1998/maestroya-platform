import { ScrollText } from "lucide-react";

import { makeListAdminAuditLogsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { EmptyState } from "@/components/ui/empty-state";

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
        <EmptyState icon={ScrollText} title="No audit log entries yet" description="Sensitive admin actions will be recorded here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {logs.map((log) => (
                <tr key={log.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">{log.createdAt.toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs">{log.adminUserId ?? "system"}</td>
                  <td className="px-4 py-3">{log.action}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {log.targetType}
                    {log.targetId ? `/${log.targetId}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminTablePager page={page} hasNextPage={logs.length === DEFAULT_PAGE_SIZE} buildHref={(p) => `/admin/audit-logs?page=${p}`} />
    </div>
  );
}
