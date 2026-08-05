import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { makeListAdminCompanyVerificationsUseCase } from "@/application/use-cases/company-verification/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { VERIFICATION_CASE_STATUS_VALUES } from "@/domain/services/company-verification-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";

export const metadata = { title: "Admin — Company verifications" };

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Company verifications"
        subtitle="Review company business/identity verification requests."
      />

      <AdminFilterForm aria-label="Filter company verifications" submitLabel="Filter">
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="h-10 w-auto">
          <option value="">All statuses</option>
          {VERIFICATION_CASE_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </AdminFilterForm>

      {verifications.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No company verification requests found" description="Company verification requests will appear here." />
      ) : (
        <AdminDataTable caption="Company verifications" minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>Company</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Submitted</AdminTh>
            <AdminTh>Reviewed</AdminTh>
            <AdminTh>
              <span className="sr-only">Review</span>
            </AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {verifications.map((v) => (
              <AdminTableRow key={v.id}>
                <td className="px-4 py-3">{v.companyLegalName}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={v.status} />
                </td>
                <td className="px-4 py-3">{v.submittedAt ? v.submittedAt.toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">{v.reviewedAt ? v.reviewedAt.toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/company-verifications/${v.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    Review<span className="sr-only"> {v.companyLegalName}</span>
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
