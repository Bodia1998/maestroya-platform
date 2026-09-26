import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { makeListAdminCompanyVerificationsUseCase } from "@/application/use-cases/company-verification/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { VERIFICATION_CASE_STATUS_VALUES } from "@/domain/services/company-verification-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { getStatusLabeler } from "../_lib/status-label";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("companyVerifications.title") }) };
}

type SearchParams = Promise<{ page?: string; status?: string }>;

const STATUS_SET = new Set<string>(VERIFICATION_CASE_STATUS_VALUES);

/** Module 18 — Company Professional: admin company-verification queue —
 *  mirrors admin/verifications/page.tsx (Module 17). */
export default async function AdminCompanyVerificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status && STATUS_SET.has(params.status) ? params.status : undefined;
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const verifications = await makeListAdminCompanyVerificationsUseCase().execute({
    limit: DEFAULT_PAGE_SIZE,
    offset,
    status: status as (typeof VERIFICATION_CASE_STATUS_VALUES)[number] | undefined,
  });

  const qs = (p: number) => `/admin/company-verifications?page=${p}${status ? `&status=${status}` : ""}`;

  const t = await getTranslations("admin");
  const format = await getFormatter();
  const statusLabel = await getStatusLabeler();
  const srOnly = (chunks: React.ReactNode) => <span className="sr-only">{chunks}</span>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("companyVerifications.title")}
        subtitle={t("companyVerifications.subtitle")}
      />

      <AdminFilterForm aria-label={t("companyVerifications.filterLabel")} submitLabel={t("table.filter")}>
        <Select name="status" defaultValue={status ?? ""} aria-label={t("common.filterByStatus")} className="h-10 w-auto">
          <option value="">{t("common.allStatuses")}</option>
          {VERIFICATION_CASE_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </AdminFilterForm>

      {verifications.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t("companyVerifications.empty")} description={t("companyVerifications.emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("companyVerifications.title")} minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>{t("companyVerifications.columns.company")}</AdminTh>
            <AdminTh>{t("common.columns.status")}</AdminTh>
            <AdminTh>{t("common.columns.submitted")}</AdminTh>
            <AdminTh>{t("common.columns.reviewed")}</AdminTh>
            <AdminTh>
              <span className="sr-only">{t("common.review")}</span>
            </AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {verifications.map((v) => (
              <AdminTableRow key={v.id}>
                <td className="px-4 py-3">{v.companyLegalName}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={v.status} />
                </td>
                <td className="px-4 py-3">{v.submittedAt ? format.dateTime(v.submittedAt, { dateStyle: "medium" }) : "—"}</td>
                <td className="px-4 py-3">{v.reviewedAt ? format.dateTime(v.reviewedAt, { dateStyle: "medium" }) : "—"}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/company-verifications/${v.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {t.rich("common.reviewItem", { name: v.companyLegalName, sr: srOnly })}
                  </Link>
                </td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={verifications.length === DEFAULT_PAGE_SIZE} buildHref={(p) => qs(p)} />
    </div>
  );
}
