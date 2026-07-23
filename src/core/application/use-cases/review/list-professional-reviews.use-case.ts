import type {
  ListProfessionalReviewsOptions,
  ReviewRecord,
  ReviewRepository,
} from "@/domain/repositories/review-repository";

/**
 * Reviews & Ratings module (Module 13): public listing of a professional's
 * PUBLISHED reviews (see PrismaReviewRepository's status filter) — no
 * `requireAuth()` at the Server Action/page boundary is required for this
 * use case, mirroring Professional Discovery's own public
 * findPublicProfileById (professional profiles are publicly browsable in
 * this product; see the marketing professionals/[id]/page.tsx route).
 * `revieweeProfessionalProfileId` is accepted as-is here — it identifies
 * whose reviews to list, not a claim of ownership, same as `jobId`
 * elsewhere in this module.
 *
 * Deliberately does not expose `reviewerId` translated to any
 * customer-identifying display data — callers get back the raw
 * `ReviewRecord` (rating, comment, timestamps, ids), and it is the
 * presentation layer's job to decide what (if anything) to show about the
 * author; this use case does not join in customer name/contact info at
 * all, so there is nothing private to leak.
 */
export class ListProfessionalReviewsUseCase {
  constructor(private readonly reviews: ReviewRepository) {}

  async execute(professionalProfileId: string, options: ListProfessionalReviewsOptions): Promise<ReviewRecord[]> {
    return this.reviews.listByProfessionalId(professionalProfileId, options);
  }
}
