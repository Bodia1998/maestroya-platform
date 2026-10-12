import { Inbox } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { listAdminLeadsAction } from "./actions";
import { PrivacyNote, SectionNav, ShortId, formatWhen } from "./_components/lead-ops-ui";
import { AdminDataTable, AdminTableBody, AdminTableHeadRow, AdminTableRow, AdminTh } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LEAD_STATUSES } from "@/domain/services/lead";
import { LEAD_ADMIN_DEFAULT_PAGE_SIZE } from "@/domain/services/lead-admin-console";
import { LEAD_PURCHASE_STATUSES } from "@/domain/services/lead-purchase";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("leadOps.sections.leads") }) };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const FILTER_KEYS = ["leadId", "status", "purchaseStatus", "categoryId", "region", "city", "createdFrom", "createdTo"] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Module 157 — lead operations overview: server-side filters and bounded server-side pagination. Read-only. */
export default async function AdminLeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const page = Math.max(1, Math.min(Number(one(sp.page)) || 1, 500));
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = one(sp[key]);
    if (value) filters[key] = value;
  }

  const result = await listAdminLeadsAction({ ...filters, limit: LEAD_ADMIN_DEFAULT_PAGE_SIZE, offset: (page - 1) * LEAD_ADMIN_DEFAULT_PAGE_SIZE });
  const leads = result.success ? result.data : [];
  const t = await getTranslations("admin.leadOps");

  const href = (p: number) => {
    const qs = new URLSearchParams(filters);
    qs.set("page", String(p));
    return `/admin/leads?${qs.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SectionNav active="leads" />
      <PrivacyNote />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label={t("filters.label")} submitLabel={t("filters.apply")}>
        <Input name="leadId" defaultValue={filters.leadId} placeholder={t("filters.leadId")} aria-label={t("filters.leadId")} className="min-w-[260px] flex-1" />
        <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("filters.status")}>
          <option value="">{t("filters.allStatuses")}</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select name="purchaseStatus" defaultValue={filters.purchaseStatus ?? ""} aria-label={t("filters.purchaseStatus")}>
          <option value="">{t("filters.anyPurchaseStatus")}</option>
          {LEAD_PURCHASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input name="categoryId" defaultValue={filters.categoryId} placeholder={t("filters.categoryId")} aria-label={t("filters.categoryId")} className="min-w-[220px]" />
        <Input name="region" defaultValue={filters.region} placeholder={t("filters.region")} aria-label={t("filters.region")} />
        <Input name="city" defaultValue={filters.city} placeholder={t("filters.city")} aria-label={t("filters.city")} />
        <Input name="createdFrom" type="date" defaultValue={filters.createdFrom} aria-label={t("filters.createdFrom")} />
        <Input name="createdTo" type="date" defaultValue={filters.createdTo} aria-label={t("filters.createdTo")} />
      </AdminFilterForm>

      {leads.length === 0 ? (
        <EmptyState icon={Inbox} title={t("empty")} description={t("emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("sections.leads")} minWidth={960}>
          <AdminTableHeadRow>
            <AdminTh>{t("columns.lead")}</AdminTh>
            <AdminTh>{t("columns.status")}</AdminTh>
            <AdminTh>{t("columns.category")}</AdminTh>
            <AdminTh>{t("columns.location")}</AdminTh>
            <AdminTh>{t("columns.created")}</AdminTh>
            <AdminTh>{t("columns.fee")}</AdminTh>
            <AdminTh>{t("columns.purchases")}</AdminTh>
            <AdminTh>{t("columns.openClaims")}</AdminTh>
            <AdminTh>{t("columns.openDisputes")}</AdminTh>
            <AdminTh>{t("columns.revoked")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {leads.map((lead) => (
              <AdminTableRow key={lead.id}>
                <td className="px-4 py-3">
                  <ShortId id={lead.id} href={`/admin/leads/${lead.id}`} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={lead.status} />
                </td>
                <td className="px-4 py-3">{lead.categoryName}</td>
                <td className="px-4 py-3">{[lead.city, lead.province].filter(Boolean).join(", ") || "—"}</td>
                <td className="px-4 py-3">{formatWhen(lead.createdAt)}</td>
                <td className="px-4 py-3">{lead.publicationPrice ? `${lead.publicationPrice} ${lead.publicationCurrency ?? ""}` : "—"}</td>
                <td className="px-4 py-3">
                  {Object.entries(lead.purchaseCounts)
                    .map(([status, count]) => `${status} ${count}`)
                    .join(" · ") || "—"}
                  {lead.maxBuyers !== null ? ` / ${lead.maxBuyers}` : ""}
                </td>
                <td className="px-4 py-3">{lead.openClaims}</td>
                <td className="px-4 py-3">{lead.openDisputes}</td>
                <td className="px-4 py-3">{lead.revokedPurchases}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={leads.length === LEAD_ADMIN_DEFAULT_PAGE_SIZE} buildHref={href} />
    </div>
  );
}
