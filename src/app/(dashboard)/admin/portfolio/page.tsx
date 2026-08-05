import Link from "next/link";

import { moderatePortfolioItemFormAction, restorePortfolioItemFormAction } from "@/app/(dashboard)/admin/actions";
import { makeListAdminPortfolioItemsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata = { title: "Admin — Portfolio" };

type SearchParams = Promise<{ page?: string }>;

/** Admin Panel module (Module 16): portfolio moderation — list, view,
 *  hide/restore (PortfolioItem.moderatedAt). Never hard-deletes and never
 *  touches Module 14's own `deletedAt` (owner-driven soft delete). */
export default async function AdminPortfolioPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const items = await makeListAdminPortfolioItemsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Portfolio items" subtitle="Moderate professionals' showcased work." />

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No portfolio items found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Title</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isModerated = item.moderatedAt !== null;
              const isDeleted = item.deletedAt !== null;
              return (
                <tr key={item.id} className="border-b border-border/50 align-top">
                  <td className="py-2 pr-4">{item.title}</td>
                  <td className="py-2 pr-4">{isDeleted ? "Deleted (owner)" : isModerated ? "Hidden (admin)" : "Visible"}</td>
                  <td className="py-2 pr-4">
                    {!isDeleted && (
                      <div className="flex gap-2">
                        {!isModerated && (
                          <form action={moderatePortfolioItemFormAction.bind(null, item.id, undefined)}>
                            <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                              Hide
                            </button>
                          </form>
                        )}
                        {isModerated && (
                          <form action={restorePortfolioItemFormAction.bind(null, item.id)}>
                            <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                              Restore
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/admin/portfolio?page=${page - 1}`}>← Previous</Link> : <span />}
        {items.length === DEFAULT_PAGE_SIZE && <Link href={`/admin/portfolio?page=${page + 1}`}>Next →</Link>}
      </div>
    </div>
  );
}
