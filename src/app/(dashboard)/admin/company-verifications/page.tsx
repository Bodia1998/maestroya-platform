import Link from "next/link";

import { makeListAdminCompanyVerificationsUseCase } from "@/application/use-cases/company-verification/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { VERIFICATION_CASE_STATUS_VALUES } from "@/domain/services/company-verification-rules";
import { PageHeader } from "@/components/dashboard/page-header";

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

      <form method="get" className="flex gap-2">
        <select name="status" defaultValue={status ?? ""} className="h-10 rounded-md border border-border px-2 text-sm">
          <option value="">All statuses</option>
          {VERIFICATION_CASE_STATUS_VALUES.map((s) => (
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
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No company verification requests found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Company</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Submitted</th>
              <th className="py-2 pr-4">Reviewed</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {verifications.map((v) => (
              <tr key={v.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{v.companyLegalName}</td>
                <td className="py-2 pr-4">{v.status}</td>
                <td className="py-2 pr-4">{v.submittedAt ? v.submittedAt.toLocaleDateString() : "—"}</td>
                <td className="py-2 pr-4">{v.reviewedAt ? v.reviewedAt.toLocaleDateString() : "—"}</td>
                <td className="py-2 pr-4">
                  <Link href={`/admin/company-verifications/${v.id}`} className="underline">
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={qs(page - 1)}>← Previous</Link> : <span />}
        {verifications.length === DEFAULT_PAGE_SIZE && <Link href={qs(page + 1)}>Next →</Link>}
      </div>
    </div>
  );
}
