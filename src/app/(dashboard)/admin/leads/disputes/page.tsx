import { ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { listAdminLeadDisputesAction } from "../actions";
import { PrivacyNote, SectionNav, ShortId, formatWhen } from "../_components/lead-ops-ui";
import { AdminDataTable, AdminTableBody, AdminTableHeadRow, AdminTableRow, AdminTh } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { LEAD_ADMIN_DEFAULT_PAGE_SIZE } from "@/domain/services/lead-admin-console";
import { LEAD_FEE_DISPUTE_STATUSES } from "@/domain/services/lead-fee-dispute";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("leadOps.sections.disputes") }) };
}

type SearchParams = Promise<{ page?: string; status?: string }>;

/** Module 157 — M155 lead-fee disputes (chargebacks) queue. Read-only: dispute state only ever changes through the signature-verified webhook. */
export default async function AdminLeadDisputesPage({ searchParams }: { searchParams: SearchParams }) {
  const { page: pageParam, status } = await searchParams;
  const page = Math.max(1, Math.min(Number(pageParam) || 1, 500));
  const result = await listAdminLeadDisputesAction({ status, limit: LEAD_ADMIN_DEFAULT_PAGE_SIZE, offset: (page - 1) * LEAD_ADMIN_DEFAULT_PAGE_SIZE });
  const disputes = result.success ? result.data : [];
  const t = await getTranslations("admin.leadOps");
  const href = (p: number) => `/admin/leads/disputes?page=${p}${status ? `&status=${encodeURIComponent(status)}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("disputesQueue.title")} subtitle={t("disputesQueue.subtitle")} />
      <SectionNav active="disputes" />
      <PrivacyNote />
      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}
      <AdminFilterForm aria-label={t("filters.label")} submitLabel={t("filters.apply")}>
        <Select name="status" defaultValue={status ?? ""} aria-label={t("filters.status")}>
          <option value="">{t("disputesQueue.openOnly")}</option>
          {LEAD_FEE_DISPUTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </AdminFilterForm>

      {disputes.length === 0 ? (
        <EmptyState icon={ShieldAlert} title={t("disputesQueue.empty")} description={t("disputesQueue.emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("disputesQueue.title")} minWidth={860}>
          <AdminTableHeadRow>
            <AdminTh>{t("disputesQueue.dispute")}</AdminTh>
            <AdminTh>{t("columns.status")}</AdminTh>
            <AdminTh>{t("disputesQueue.purchaseStatus")}</AdminTh>
            <AdminTh>{t("disputesQueue.amount")}</AdminTh>
            <AdminTh>{t("detail.openedAt")}</AdminTh>
            <AdminTh>{t("disputesQueue.evidenceDueBy")}</AdminTh>
            <AdminTh>{t("detail.evidence")}</AdminTh>
            <AdminTh>{t("columns.lead")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {disputes.map((d) => (
              <AdminTableRow key={d.id}>
                <td className="px-4 py-3"><ShortId id={d.id} /></td>
                <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                <td className="px-4 py-3"><StatusBadge status={d.purchaseStatus} /></td>
                <td className="px-4 py-3">{d.amount} {d.currency}</td>
                <td className="px-4 py-3">{formatWhen(d.openedAt)}</td>
                <td className="px-4 py-3">{formatWhen(d.evidenceDueBy)}</td>
                <td className="px-4 py-3">{d.evidenceStatus}</td>
                <td className="px-4 py-3"><ShortId id={d.leadId} href={`/admin/leads/${d.leadId}`} /></td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}
      <AdminTablePager page={page} hasNextPage={disputes.length === LEAD_ADMIN_DEFAULT_PAGE_SIZE} buildHref={href} />
    </div>
  );
}
