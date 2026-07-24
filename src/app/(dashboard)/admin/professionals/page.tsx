import Link from "next/link";

import { makeListAdminProfessionalsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";

export const metadata = { title: "Admin — Professionals" };

type SearchParams = Promise<{ page?: string; search?: string }>;

/** Admin Panel module (Module 16): read-only professional oversight. No
 *  verification workflow here — that's Module 17 (see the module spec's
 *  5.3 boundary). */
export default async function AdminProfessionalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const search = params.search?.trim() || undefined;
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const professionals = await makeListAdminProfessionalsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset, search });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Professionals</h1>
        <p className="mt-1 text-sm text-foreground/70">Read-only oversight of professional profiles.</p>
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search by business name, name, or email"
          className="h-10 flex-1 rounded-md border border-border px-3 text-sm"
        />
        <button type="submit" className="h-10 rounded-md border border-border px-4 text-sm">
          Search
        </button>
      </form>

      {professionals.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No professionals found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Business name</th>
              <th className="py-2 pr-4">Owner</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Verification</th>
              <th className="py-2 pr-4">Rating</th>
              <th className="py-2 pr-4">Portfolio</th>
            </tr>
          </thead>
          <tbody>
            {professionals.map((pro) => (
              <tr key={pro.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{pro.businessName ?? "—"}</td>
                <td className="py-2 pr-4">{pro.userName ?? pro.userEmail ?? "—"}</td>
                <td className="py-2 pr-4">{pro.status}</td>
                <td className="py-2 pr-4">{pro.verificationStatus}</td>
                <td className="py-2 pr-4">
                  {pro.averageRating !== null ? `${pro.averageRating} (${pro.reviewCount})` : "—"}
                </td>
                <td className="py-2 pr-4">{pro.portfolioItemCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? (
          <Link href={`/admin/professionals?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}>
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {professionals.length === DEFAULT_PAGE_SIZE && (
          <Link href={`/admin/professionals?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}>
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
