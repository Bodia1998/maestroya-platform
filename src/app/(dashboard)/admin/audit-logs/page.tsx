import { ScrollText } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { makeListAdminAuditLogsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { EmptyState } from "@/components/ui/empty-state";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("auditLogsPage.title") }) };
}

type SearchParams = Promise<{ page?: string }>;

/** Admin Panel module (Module 16): read-only, paginated view of the
 *  append-only admin audit trail (see AdminAuditLogRepository). No edit or
 *  delete action exists anywhere in this module for these records. */
export default async function AdminAuditLogsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const logs = await makeListAdminAuditLogsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset });

  const t = await getTranslations("admin");
  const format = await getFormatter();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("auditLogsPage.title")} subtitle={t("auditLogsPage.subtitle")} />

      {logs.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("auditLogsPage.empty")} description={t("auditLogsPage.emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("auditLogsPage.title")} minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>{t("auditLogsPage.columns.when")}</AdminTh>
            <AdminTh>{t("auditLogsPage.columns.admin")}</AdminTh>
            <AdminTh>{t("auditLogsPage.columns.action")}</AdminTh>
            <AdminTh>{t("auditLogsPage.columns.target")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {logs.map((log) => (
              <AdminTableRow key={log.id}>
                <td className="px-4 py-3">{format.dateTime(log.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.adminUserId ?? t("auditLogsPage.system")}</td>
                <td className="px-4 py-3">{log.action}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {log.targetType}
                  {log.targetId ? `/${log.targetId}` : ""}
                </td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={logs.length === DEFAULT_PAGE_SIZE} buildHref={(p) => `/admin/audit-logs?page=${p}`} />
    </div>
  );
}
