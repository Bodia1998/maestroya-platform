import { Image as ImageIcon } from "lucide-react";

import { moderatePortfolioItemFormAction, restorePortfolioItemFormAction } from "@/app/(dashboard)/admin/actions";
import { makeListAdminPortfolioItemsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminRowActionButton } from "@/components/dashboard/admin-row-action-button";
import { EmptyState } from "@/components/ui/empty-state";

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
        <EmptyState icon={ImageIcon} title="No portfolio items found" description="Work samples professionals showcase will appear here." />
      ) : (
        <AdminDataTable caption="Portfolio items" minWidth={480}>
          <AdminTableHeadRow>
            <AdminTh>Title</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Actions</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {items.map((item) => {
              const isModerated = item.moderatedAt !== null;
              const isDeleted = item.deletedAt !== null;
              return (
                <AdminTableRow key={item.id} className="align-top">
                  <td className="px-4 py-3">{item.title}</td>
                  <td className="px-4 py-3">{isDeleted ? "Deleted (owner)" : isModerated ? "Hidden (admin)" : "Visible"}</td>
                  <td className="px-4 py-3">
                    {!isDeleted && (
                      <div className="flex flex-wrap gap-2">
                        {!isModerated && (
                          <form action={moderatePortfolioItemFormAction.bind(null, item.id, undefined)}>
                            <AdminRowActionButton>
                              Hide<span className="sr-only"> {item.title}</span>
                            </AdminRowActionButton>
                          </form>
                        )}
                        {isModerated && (
                          <form action={restorePortfolioItemFormAction.bind(null, item.id)}>
                            <AdminRowActionButton>
                              Restore<span className="sr-only"> {item.title}</span>
                            </AdminRowActionButton>
                          </form>
                        )}
                      </div>
                    )}
                  </td>
                </AdminTableRow>
              );
            })}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={items.length === DEFAULT_PAGE_SIZE} buildHref={(p) => `/admin/portfolio?page=${p}`} />
    </div>
  );
}
