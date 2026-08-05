import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { makeListAdminVerificationsUseCase } from "@/application/use-cases/verification/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PROFESSIONAL_VERIFICATION_STATUS_VALUES } from "@/domain/services/professional-verification-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

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

      <form method="get" className="flex gap-2">
        <select name="status" defaultValue={status ?? ""} className="h-10 rounded-md border border-border px-2 text-sm">
          <option value="">All statuses</option>
          {PROFESSIONAL_VERIFICATION_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" className="h-10 rounded-md border border-border px-4 text-sm">
          Filter
        </button>
      </form>

      {verifications.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No verification requests found" description="Professional identity verification requests will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Professional</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Reviewed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {verifications.map((v) => (
                <tr key={v.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">{v.businessName ?? v.professionalName ?? v.professionalEmail ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="px-4 py-3">{v.submittedAt ? v.submittedAt.toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">{v.reviewedAt ? v.reviewedAt.toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/verifications/${v.id}`} className="font-medium text-primary hover:underline">
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminTablePager page={page} hasNextPage={verifications.length === DEFAULT_PAGE_SIZE} buildHref={(p) => qs(p)} />
    </div>
  );
}
