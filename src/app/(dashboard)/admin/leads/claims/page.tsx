import { ClipboardList } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { listAdminLeadClaimsAction } from "../actions";
import { PrivacyNote, SectionNav, ShortId, formatWhen } from "../_components/lead-ops-ui";
import { AdminDataTable, AdminTableBody, AdminTableHeadRow, AdminTableRow, AdminTh } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { LEAD_ADMIN_DEFAULT_PAGE_SIZE } from "@/domain/services/lead-admin-console";
import { LEAD_QUALITY_CLAIM_STATUSES } from "@/domain/services/lead-quality-claim";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("leadOps.sections.claims") }) };
}

type SearchParams = Promise<{ page?: string; status?: string }>;

/** Module 157 — M154 claims queue (open claims by default, oldest response target first). Read-only; decisions happen on the lead page. */
export default async function AdminLeadClaimsPage({ searchParams }: { searchParams: SearchParams }) {
  const { page: pageParam, status } = await searchParams;
  const page = Math.max(1, Math.min(Number(pageParam) || 1, 500));
  const result = await listAdminLeadClaimsAction({ status, limit: LEAD_ADMIN_DEFAULT_PAGE_SIZE, offset: (page - 1) * LEAD_ADMIN_DEFAULT_PAGE_SIZE });
  const claims = result.success ? result.data : [];
  const t = await getTranslations("admin.leadOps");
  const href = (p: number) => `/admin/leads/claims?page=${p}${status ? `&status=${encodeURIComponent(status)}` : ""}`;
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("claimsQueue.title")} subtitle={t("claimsQueue.subtitle")} />
      <SectionNav active="claims" />
      <PrivacyNote />
      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}
      <AdminFilterForm aria-label={t("filters.label")} submitLabel={t("filters.apply")}>
        <Select name="status" defaultValue={status ?? ""} aria-label={t("filters.status")}>
          <option value="">{t("claimsQueue.openOnly")}</option>
          {LEAD_QUALITY_CLAIM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </AdminFilterForm>

      {claims.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("claimsQueue.empty")} description={t("claimsQueue.emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("claimsQueue.title")} minWidth={720}>
          <AdminTableHeadRow>
            <AdminTh>{t("claimsQueue.claim")}</AdminTh>
            <AdminTh>{t("columns.status")}</AdminTh>
            <AdminTh>{t("claimsQueue.reason")}</AdminTh>
            <AdminTh>{t("detail.respondBy")}</AdminTh>
            <AdminTh>{t("columns.lead")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {claims.map((c) => (
              <AdminTableRow key={c.id}>
                <td className="px-4 py-3"><ShortId id={c.id} /></td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3">{c.reasonCode}</td>
                <td className="px-4 py-3">
                  {formatWhen(c.respondBy)}
                  {(c.status === "SUBMITTED" || c.status === "UNDER_REVIEW") && c.respondBy.getTime() < now ? ` · ${t("claimsQueue.targetPassed")}` : ""}
                </td>
                <td className="px-4 py-3">{c.leadId ? <ShortId id={c.leadId} href={`/admin/leads/${c.leadId}`} /> : "—"}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}
      <AdminTablePager page={page} hasNextPage={claims.length === LEAD_ADMIN_DEFAULT_PAGE_SIZE} buildHref={href} />
    </div>
  );
}
