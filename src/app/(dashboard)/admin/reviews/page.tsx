import Link from "next/link";

import { moderateReviewFormAction, restoreReviewFormAction } from "@/app/(dashboard)/admin/actions";
import { makeListAdminReviewsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";

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
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No reviews found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Rating</th>
              <th className="py-2 pr-4">Comment</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((review) => (
              <tr key={review.id} className="border-b border-border/50 align-top">
                <td className="py-2 pr-4">{review.rating}/5</td>
                <td className="max-w-xs truncate py-2 pr-4">{review.comment ?? "—"}</td>
                <td className="py-2 pr-4">{review.status}</td>
                <td className="py-2 pr-4">
                  <div className="flex gap-2">
                    {review.status !== "REMOVED" && (
                      <form action={moderateReviewFormAction.bind(null, review.id, undefined)}>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                          Hide
                        </button>
                      </form>
                    )}
                    {review.status === "REMOVED" && (
                      <form action={restoreReviewFormAction.bind(null, review.id)}>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                          Restore
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/admin/reviews?page=${page - 1}`}>← Previous</Link> : <span />}
        {reviews.length === DEFAULT_PAGE_SIZE && <Link href={`/admin/reviews?page=${page + 1}`}>Next →</Link>}
      </div>
    </div>
  );
}
