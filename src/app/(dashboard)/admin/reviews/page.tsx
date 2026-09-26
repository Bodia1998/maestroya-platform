import { Star } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { moderateReviewFormAction, restoreReviewFormAction } from "@/app/(dashboard)/admin/actions";
import { makeListAdminReviewsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminRowActionButton } from "@/components/dashboard/admin-row-action-button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("reviewsPage.title") }) };
}

type SearchParams = Promise<{ page?: string }>;

/** Admin Panel module (Module 16): review moderation — list, view, hide
 *  (REMOVED), restore (PUBLISHED). Module 13's own public listing/rating
 *  queries already exclude anything not PUBLISHED. */
export default async function AdminReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const reviews = await makeListAdminReviewsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset });

  const t = await getTranslations("admin");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("reviewsPage.title")} subtitle={t("reviewsPage.subtitle")} />

      {reviews.length === 0 ? (
        <EmptyState icon={Star} title={t("reviewsPage.empty")} description={t("reviewsPage.emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("reviewsPage.title")} minWidth={560}>
          <AdminTableHeadRow>
            <AdminTh>{t("common.columns.rating")}</AdminTh>
            <AdminTh>{t("reviewsPage.columns.comment")}</AdminTh>
            <AdminTh>{t("common.columns.status")}</AdminTh>
            <AdminTh>{t("common.columns.actions")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {reviews.map((review) => (
              <AdminTableRow key={review.id} className="align-top">
                <td className="px-4 py-3">{t("reviewsPage.ratingOutOfFive", { rating: review.rating })}</td>
                <td className="max-w-xs truncate px-4 py-3">{review.comment ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={review.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {review.status !== "REMOVED" && (
                      <form action={moderateReviewFormAction.bind(null, review.id, undefined)}>
                        <AdminRowActionButton>{t("reviewsPage.hide")}</AdminRowActionButton>
                      </form>
                    )}
                    {review.status === "REMOVED" && (
                      <form action={restoreReviewFormAction.bind(null, review.id)}>
                        <AdminRowActionButton>{t("reviewsPage.restore")}</AdminRowActionButton>
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
