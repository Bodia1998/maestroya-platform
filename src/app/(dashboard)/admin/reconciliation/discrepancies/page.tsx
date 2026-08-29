import { AlertOctagon } from "lucide-react";

import { listDiscrepanciesAction } from "../actions";
import { CATEGORY_VALUES, ENTITY_TYPE_VALUES } from "@/application/dto/reconciliation.dto";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ButtonLink } from "@/components/ui/button-link";
import { formatMoney } from "@/components/dashboard/quote-items-table";
import { SeverityBadge, ResolutionStatusBadge } from "../_components/badges";

export const metadata = { title: "Admin — Discrepancies" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  page?: string;
  resolutionStatus?: string;
  severity?: string;
  category?: string;
  entityType?: string;
  detectedFrom?: string;
  detectedTo?: string;
}>;

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the dedicated
 * discrepancy investigation table (spec sections 7–8). Every filter is
 * applied server-side by `ListDiscrepanciesUseCase`/
 * `ReconciliationDiscrepancyRepository.list` — this page never fetches an
 * unfiltered/unbounded set and filters it in the browser. Filters live in
 * the URL's search params (same convention as every other admin list's
 * `?status=`), so an investigation URL is shareable and survives a
 * refresh.
 */
export default async function AdminReconciliationDiscrepanciesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const resolutionStatus = params.resolutionStatus?.trim() || undefined;
  const severity = params.severity?.trim() || undefined;
  const category = params.category?.trim() || undefined;
  const entityType = params.entityType?.trim() || undefined;
  const detectedFrom = params.detectedFrom?.trim() || undefined;
  const detectedTo = params.detectedTo?.trim() || undefined;

  const result = await listDiscrepanciesAction({
    resolutionStatus,
    severity,
    category,
    entityType,
    detectedFrom,
    detectedTo,
    limit: DEFAULT_PAGE_SIZE,
    offset,
  });
  const discrepancies = result.success ? result.data : [];

  const qs = (p: number) => {
    const parts = [`page=${p}`];
    if (resolutionStatus) parts.push(`resolutionStatus=${encodeURIComponent(resolutionStatus)}`);
    if (severity) parts.push(`severity=${encodeURIComponent(severity)}`);
    if (category) parts.push(`category=${encodeURIComponent(category)}`);
    if (entityType) parts.push(`entityType=${encodeURIComponent(entityType)}`);
    if (detectedFrom) parts.push(`detectedFrom=${encodeURIComponent(detectedFrom)}`);
    if (detectedTo) parts.push(`detectedTo=${encodeURIComponent(detectedTo)}`);
    return `/admin/reconciliation/discrepancies?${parts.join("&")}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Discrepancies"
        subtitle="Detected financial inconsistencies awaiting or already given a resolution."
        breadcrumbs={[{ label: "Reconciliation", href: "/admin/reconciliation" }, { label: "Discrepancies" }]}
      />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label="Filter discrepancies" submitLabel="Filter" className="items-end">
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-resolutionStatus">Status</Label>
          <Select id="filter-resolutionStatus" name="resolutionStatus" defaultValue={resolutionStatus ?? ""} className="h-10 w-auto">
            <option value="">Any</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-severity">Severity</Label>
          <Select id="filter-severity" name="severity" defaultValue={severity ?? ""} className="h-10 w-auto">
            <option value="">Any</option>
            <option value="CRITICAL">Critical</option>
            <option value="ERROR">High</option>
            <option value="WARNING">Medium</option>
            <option value="INFO">Low</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-entityType">Entity type</Label>
          <Select id="filter-entityType" name="entityType" defaultValue={entityType ?? ""} className="h-10 w-auto">
            <option value="">Any</option>
            {ENTITY_TYPE_VALUES.map((v) => (
              <option key={v} value={v}>
                {v.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-category">Type</Label>
          <Select id="filter-category" name="category" defaultValue={category ?? ""} className="h-10 w-auto max-w-[220px]">
            <option value="">Any</option>
            {CATEGORY_VALUES.map((v) => (
              <option key={v} value={v}>
                {v.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-detectedFrom">Detected from</Label>
          <Input id="filter-detectedFrom" type="date" name="detectedFrom" defaultValue={detectedFrom ?? ""} className="h-10 w-auto" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-detectedTo">Detected to</Label>
          <Input id="filter-detectedTo" type="date" name="detectedTo" defaultValue={detectedTo ?? ""} className="h-10 w-auto" />
        </div>
      </AdminFilterForm>

      {discrepancies.length === 0 ? (
        <EmptyState icon={AlertOctagon} title="No discrepancies found" description="Try a different filter, or narrow the date range." />
      ) : (
        <AdminDataTable caption="Discrepancies" minWidth={860}>
          <AdminTableHeadRow>
            <AdminTh>Discrepancy</AdminTh>
            <AdminTh>Entity</AdminTh>
            <AdminTh>Type</AdminTh>
            <AdminTh>Severity</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Difference</AdminTh>
            <AdminTh>Detected</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {discrepancies.map((d) => (
              <AdminTableRow key={d.id}>
                <td className="px-4 py-3">
                  <ButtonLink href={`/admin/reconciliation/discrepancies/${d.id}`} variant="link" className="h-auto p-0 font-mono text-xs">
                    {d.id.slice(0, 8)}…
                  </ButtonLink>
                </td>
                <td className="px-4 py-3">{d.entityType}</td>
                <td className="px-4 py-3 text-xs">{d.category.replaceAll("_", " ").toLowerCase()}</td>
                <td className="px-4 py-3">
                  <SeverityBadge severity={d.severity} />
                </td>
                <td className="px-4 py-3">
                  <ResolutionStatusBadge status={d.resolutionStatus} />
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {d.differenceValue !== null ? formatMoney(d.differenceValue, d.currency ?? "EUR") : "—"}
                </td>
                <td className="px-4 py-3">{new Date(d.detectedAt).toLocaleDateString()}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={discrepancies.length === DEFAULT_PAGE_SIZE} buildHref={qs} />
    </div>
  );
}
