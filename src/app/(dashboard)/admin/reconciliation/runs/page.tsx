import { ListChecks } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { listReconciliationRunsAction } from "../actions";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { ButtonLink } from "@/components/ui/button-link";
import { RunStatusBadge } from "../_components/badges";
import { TriggerRunDialog } from "../_components/trigger-run-dialog";
import { formatDuration } from "../_components/format-duration";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("reconciliation.runs.title") }) };
}
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ page?: string; status?: string }>;

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the admin Runs
 * list — newest first, optionally filtered by status, server-side
 * paginated (never loads more than one page's worth of rows — see
 * `ListReconciliationRunsUseCase`). Same list/filter/pager shape as every
 * other admin list page (e.g. `admin/disputes/page.tsx`, `admin/companies/page.tsx`).
 */
export default async function AdminReconciliationRunsPage({ searchParams }: { searchParams: SearchParams }) {
  const { page: pageParam, status } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;
  const cleanStatus = status?.trim() || undefined;

  const result = await listReconciliationRunsAction({
    status: cleanStatus,
    limit: DEFAULT_PAGE_SIZE,
    offset,
  });
  const runs = result.success ? result.data : [];

  const qs = (p: number) => {
    const parts = [`page=${p}`];
    if (cleanStatus) parts.push(`status=${encodeURIComponent(cleanStatus)}`);
    return `/admin/reconciliation/runs?${parts.join("&")}`;
  };

  const t = await getTranslations("admin");
  const tRecon = await getTranslations("admin.reconciliation");
  const format = await getFormatter();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("reconciliation.runs.title")}
        subtitle={t("reconciliation.runs.subtitle")}
        breadcrumbs={[
          { label: t("reconciliation.title"), href: "/admin/reconciliation" },
          { label: t("reconciliation.runs.breadcrumb") },
        ]}
        actions={<TriggerRunDialog />}
      />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label={t("reconciliation.runs.filterLabel")} submitLabel={t("table.filter")}>
        <Select name="status" defaultValue={cleanStatus ?? ""} aria-label={t("common.filterByStatus")} className="h-10 w-auto">
          <option value="">{t("common.allStatuses")}</option>
          <option value="RUNNING">{t("reconciliation.runStatus.RUNNING")}</option>
          <option value="COMPLETED">{t("reconciliation.runStatus.COMPLETED")}</option>
          <option value="FAILED">{t("reconciliation.runStatus.FAILED")}</option>
        </Select>
      </AdminFilterForm>

      {runs.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={t("reconciliation.runs.empty")}
          description={t("reconciliation.runs.emptyDescription")}
        />
      ) : (
        <AdminDataTable caption={t("reconciliation.runs.title")} minWidth={780}>
          <AdminTableHeadRow>
            <AdminTh>{t("reconciliation.runs.columns.run")}</AdminTh>
            <AdminTh>{t("reconciliation.runs.columns.scope")}</AdminTh>
            <AdminTh>{t("reconciliation.runs.columns.status")}</AdminTh>
            <AdminTh>{t("reconciliation.runs.columns.started")}</AdminTh>
            <AdminTh>{t("reconciliation.runs.columns.duration")}</AdminTh>
            <AdminTh>{t("reconciliation.runs.columns.recordsInspected")}</AdminTh>
            <AdminTh>{t("reconciliation.runs.columns.discrepancies")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {runs.map((run) => (
              <AdminTableRow key={run.id}>
                <td className="px-4 py-3">
                  <ButtonLink href={`/admin/reconciliation/runs/${run.id}`} variant="link" className="h-auto p-0 font-mono text-xs">
                    {run.id.slice(0, 8)}…
                  </ButtonLink>
                </td>
                <td className="px-4 py-3">
                  {tRecon.has(`scope.${run.scope}` as never) ? tRecon(`scope.${run.scope}` as never) : run.scope}
                </td>
                <td className="px-4 py-3">
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="px-4 py-3">{format.dateTime(new Date(run.startedAt), { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-4 py-3">{formatDuration(tRecon, run.durationMs)}</td>
                <td className="px-4 py-3 tabular-nums">{format.number(run.recordsInspected)}</td>
                <td className="px-4 py-3 tabular-nums">{format.number(run.discrepancyCount)}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={runs.length === DEFAULT_PAGE_SIZE} buildHref={qs} />
    </div>
  );
}
