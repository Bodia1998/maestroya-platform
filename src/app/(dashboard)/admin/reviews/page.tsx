import { Star } from "lucide-react";

import { moderateReviewFormAction, restoreReviewFormAction } from "@/app/(dashboard)/admin/actions";
import { makeListAdminReviewsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminRowActionButton } from "@/components/dashboard/admin-row-action-button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Admin — Reviews" };

type SearchParams = Promise<{ page?: string }>;

/** Admin Panel module (Module 16): review moderation — list, view, hide
 *  (REMOVED), restore (PUBLISHED). Module 13's own public listing/rating
 *  queries already exclude anything not PUBLISHED. */
export default async function AdminReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const reviews = await makeListAdminReviewsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reviews" subtitle="Moderate customer reviews of professionals." />

      {reviews.length === 0 ? (
        <EmptyState icon={Star} title="No reviews found" description="Customer reviews of professionals will appear here." />
      ) : (
        <AdminDataTable caption="Reviews" minWidth={560}>
          <AdminTableHeadRow>
            <AdminTh>Rating</AdminTh>
            <AdminTh>Comment</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Actions</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {reviews.map((review) => (
              <AdminTableRow key={review.id} className="align-top">
                <td className="px-4 py-3">{review.rating}/5</td>
                <td className="max-w-xs truncate px-4 py-3">{review.comment ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={review.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {review.status !== "REMOVED" && (
                      <form action={moderateReviewFormAction.bind(null, review.id, undefined)}>
                        <AdminRowActionButton>Hide</AdminRowActionButton>
                      </form>
                    )}
                    {review.status === "REMOVED" && (
                      <form action={restoreReviewFormAction.bind(null, review.id)}>
                        <AdminRowActionButton>Restore</AdminRowActionButton>
                      </form>
                    )}
                  </div>
                </td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={reviews.length === DEFAULT_PAGE_SIZE} buildHref={(p) => `/admin/reviews?page=${p}`} />
    </div>
  );
}
