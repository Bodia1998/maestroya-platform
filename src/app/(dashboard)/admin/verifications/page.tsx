import Link from "next/link";

import { makeListAdminVerificationsUseCase } from "@/application/use-cases/verification/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PROFESSIONAL_VERIFICATION_STATUS_VALUES } from "@/domain/services/professional-verification-rules";

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
      <div>
        <h1 className="text-2xl font-semibold">Verifications</h1>
        <p className="mt-1 text-sm text-foreground/70">Review professional identity/trust verification requests.</p>
      </div>

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
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No verification requests found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Professional</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Submitted</th>
              <th className="py-2 pr-4">Reviewed</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {verifications.map((v) => (
              <tr key={v.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{v.businessName ?? v.professionalName ?? v.professionalEmail ?? "—"}</td>
                <td className="py-2 pr-4">{v.status}</td>
                <td className="py-2 pr-4">{v.submittedAt ? v.submittedAt.toLocaleDateString() : "—"}</td>
                <td className="py-2 pr-4">{v.reviewedAt ? v.reviewedAt.toLocaleDateString() : "—"}</td>
                <td className="py-2 pr-4">
                  <Link href={`/admin/verifications/${v.id}`} className="underline">
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
