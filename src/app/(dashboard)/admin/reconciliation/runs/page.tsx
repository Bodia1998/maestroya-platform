import { ListChecks } from "lucide-react";

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

export const metadata = { title: "Admin — Reconciliation runs" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ page?: string; status?: string }>;

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reconciliation runs"
        subtitle="Every execution of the reconciliation engine, newest first."
        breadcrumbs={[{ label: "Reconciliation", href: "/admin/reconciliation" }, { label: "Runs" }]}
        actions={<TriggerRunDialog />}
      />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label="Filter reconciliation runs" submitLabel="Filter">
        <Select name="status" defaultValue={cleanStatus ?? ""} aria-label="Filter by status" className="h-10 w-auto">
          <option value="">All statuses</option>
          <option value="RUNNING">Running</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
        </Select>
      </AdminFilterForm>

      {runs.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No reconciliation runs found"
          description="Runs will appear here once the reconciliation engine executes."
        />
      ) : (
        <AdminDataTable caption="Reconciliation runs" minWidth={780}>
          <AdminTableHeadRow>
            <AdminTh>Run</AdminTh>
            <AdminTh>Scope</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Started</AdminTh>
            <AdminTh>Duration</AdminTh>
            <AdminTh>Records inspected</AdminTh>
            <AdminTh>Discrepancies</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {runs.map((run) => (
              <AdminTableRow key={run.id}>
                <td className="px-4 py-3">
                  <ButtonLink href={`/admin/reconciliation/runs/${run.id}`} variant="link" className="h-auto p-0 font-mono text-xs">
                    {run.id.slice(0, 8)}…
                  </ButtonLink>
                </td>
                <td className="px-4 py-3">{run.scope}</td>
                <td className="px-4 py-3">
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="px-4 py-3">{new Date(run.startedAt).toLocaleString()}</td>
                <td className="px-4 py-3">{formatDuration(run.durationMs)}</td>
                <td className="px-4 py-3 tabular-nums">{run.recordsInspected}</td>
                <td className="px-4 py-3 tabular-nums">{run.discrepancyCount}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={runs.length === DEFAULT_PAGE_SIZE} buildHref={qs} />
    </div>
  );
}
