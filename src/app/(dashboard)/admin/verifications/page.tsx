import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { makeListAdminVerificationsUseCase } from "@/application/use-cases/verification/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PROFESSIONAL_VERIFICATION_STATUS_VALUES } from "@/domain/services/professional-verification-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";

export const metadata = { title: "Admin — Verifications" };

type SearchParams = Promise<{ page?: string; status?: string }>;

const STATUS_SET = new Set<string>(PROFESSIONAL_VERIFICATION_STATUS_VALUES);

/**
 * Professional Verification module (Module 17): admin review queue. Route is
 * protected by (dashboard)/admin/layout.tsx (ADMIN/SUPER_ADMIN) plus
 * middleware's `/admin` role gate — same defense-in-depth as every other
 * admin page. The list carries no document URLs (see AdminVerificationListItem).
 */
export default async function AdminVerificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status && STATUS_SET.has(params.status) ? params.status : undefined;
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const verifications = await makeListAdminVerificationsUseCase().execute({
    limit: DEFAULT_PAGE_SIZE,
    offset,
    status: status as (typeof PROFESSIONAL_VERIFICATION_STATUS_VALUES)[number] | undefined,
  });

  const qs = (p: number) => `/admin/verifications?page=${p}${status ? `&status=${status}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Verifications"
        subtitle="Review professional identity/trust verification requests."
      />

      <AdminFilterForm aria-label="Filter verifications" submitLabel="Filter">
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="h-10 w-auto">
          <option value="">All statuses</option>
          {PROFESSIONAL_VERIFICATION_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </AdminFilterForm>

      {verifications.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No verification requests found" description="Professional identity verification requests will appear here." />
      ) : (
        <AdminDataTable caption="Verifications" minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>Professional</AdminTh>
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
                <td className="px-4 py-3">{v.businessName ?? v.professionalName ?? v.professionalEmail ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={v.status} />
                </td>
                <td className="px-4 py-3">{v.submittedAt ? v.submittedAt.toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">{v.reviewedAt ? v.reviewedAt.toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/verifications/${v.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    Review<span className="sr-only"> {v.businessName ?? v.professionalName ?? v.professionalEmail ?? ""}</span>
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
