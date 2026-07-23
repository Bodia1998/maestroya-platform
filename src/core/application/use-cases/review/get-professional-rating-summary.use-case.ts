import type { ProfessionalRatingSummary, ReviewRepository } from "@/domain/repositories/review-repository";

/**
 * Reviews & Ratings module (Module 13): a professional's aggregate rating
 * (average + count), computed from actual PUBLISHED reviews at read time —
 * never a denormalized value stored on ProfessionalProfile (see this
 * module's documentation for the reasoning). Public, same as
 * ListProfessionalReviewsUseCase.
 *
 * This is the seam a future Module 19 — Search & Ranking consumes: it may
 * call this use case (or the repository directly) to read a professional's
 * rating when ranking search results, but Review has and must have zero
 * dependency in the other direction.
 */
export class GetProfessionalRatingSummaryUseCase {
  constructor(private readonly reviews: ReviewRepository) {}

  async execute(professionalProfileId: string): Promise<ProfessionalRatingSummary> {
    return this.reviews.getProfessionalRatingSummary(professionalProfileId);
  }
}
