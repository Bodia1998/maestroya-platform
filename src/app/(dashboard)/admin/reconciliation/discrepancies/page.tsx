import { AlertOctagon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

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
import { SeverityBadge, ResolutionStatusBadge } from "../_components/badges";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("reconciliation.discrepancies.title") }) };
}
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

  const t = await getTranslations("admin");
  const format = await getFormatter();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("reconciliation.discrepancies.title")}
        subtitle={t("reconciliation.discrepancies.subtitle")}
        breadcrumbs={[
          { label: t("reconciliation.title"), href: "/admin/reconciliation" },
          { label: t("reconciliation.discrepancies.title") },
        ]}
      />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label={t("reconciliation.discrepancies.filterLabel")} submitLabel={t("table.filter")} className="items-end">
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-resolutionStatus">{t("reconciliation.discrepancies.filters.status")}</Label>
          <Select id="filter-resolutionStatus" name="resolutionStatus" defaultValue={resolutionStatus ?? ""} className="h-10 w-auto">
            <option value="">{t("reconciliation.discrepancies.any")}</option>
            <option value="OPEN">{t("reconciliation.resolutionStatus.OPEN")}</option>
            <option value="RESOLVED">{t("reconciliation.resolutionStatus.RESOLVED")}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-severity">{t("reconciliation.discrepancies.filters.severity")}</Label>
          <Select id="filter-severity" name="severity" defaultValue={severity ?? ""} className="h-10 w-auto">
            <option value="">{t("reconciliation.discrepancies.any")}</option>
            <option value="CRITICAL">{t("reconciliation.severity.CRITICAL")}</option>
            <option value="ERROR">{t("reconciliation.severity.ERROR")}</option>
            <option value="WARNING">{t("reconciliation.severity.WARNING")}</option>
            <option value="INFO">{t("reconciliation.severity.INFO")}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-entityType">{t("reconciliation.discrepancies.filters.entityType")}</Label>
          <Select id="filter-entityType" name="entityType" defaultValue={entityType ?? ""} className="h-10 w-auto">
            <option value="">{t("reconciliation.discrepancies.any")}</option>
            {ENTITY_TYPE_VALUES.map((v) => (
              <option key={v} value={v}>
                {v.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-category">{t("reconciliation.discrepancies.filters.type")}</Label>
          <Select id="filter-category" name="category" defaultValue={category ?? ""} className="h-10 w-auto max-w-[220px]">
            <option value="">{t("reconciliation.discrepancies.any")}</option>
            {CATEGORY_VALUES.map((v) => (
              <option key={v} value={v}>
                {v.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-detectedFrom">{t("reconciliation.discrepancies.filters.detectedFrom")}</Label>
          <Input id="filter-detectedFrom" type="date" name="detectedFrom" defaultValue={detectedFrom ?? ""} className="h-10 w-auto" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-detectedTo">{t("reconciliation.discrepancies.filters.detectedTo")}</Label>
          <Input id="filter-detectedTo" type="date" name="detectedTo" defaultValue={detectedTo ?? ""} className="h-10 w-auto" />
        </div>
      </AdminFilterForm>

      {discrepancies.length === 0 ? (
        <EmptyState icon={AlertOctagon} title={t("reconciliation.discrepancies.empty")} description={t("reconciliation.discrepancies.emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("reconciliation.discrepancies.title")} minWidth={860}>
          <AdminTableHeadRow>
            <AdminTh>{t("reconciliation.discrepancies.columns.discrepancy")}</AdminTh>
            <AdminTh>{t("reconciliation.discrepancies.columns.entity")}</AdminTh>
            <AdminTh>{t("reconciliation.discrepancies.columns.type")}</AdminTh>
            <AdminTh>{t("reconciliation.discrepancies.columns.severity")}</AdminTh>
            <AdminTh>{t("reconciliation.discrepancies.columns.status")}</AdminTh>
            <AdminTh>{t("reconciliation.discrepancies.columns.difference")}</AdminTh>
            <AdminTh>{t("reconciliation.discrepancies.columns.detected")}</AdminTh>
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
                  {d.differenceValue !== null ? format.number(d.differenceValue, { style: "currency", currency: d.currency ?? "EUR" }) : "—"}
                </td>
                <td className="px-4 py-3">{format.dateTime(new Date(d.detectedAt), { dateStyle: "medium" })}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={discrepancies.length === DEFAULT_PAGE_SIZE} buildHref={qs} />
    </div>
  );
}
