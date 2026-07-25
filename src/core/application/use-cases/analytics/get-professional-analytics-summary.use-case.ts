import { ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalAnalyticsRepository } from "@/domain/repositories/analytics-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ReviewRepository } from "@/domain/repositories/review-repository";
import { resolveAnalyticsDateRange, safeRatio } from "@/domain/services/analytics-date-range";
import { roundToCents } from "@/domain/services/money";
import type { AnalyticsDateRangeInput, ProfessionalAnalyticsSummaryDTO } from "@/application/dto/analytics.dto";
import type { GetProfessionalEarningsUseCase } from "@/application/use-cases/financial/get-professional-earnings.use-case";

/**
 * Module 23 — Analytics: a professional's own activity summary.
 *
 * Security: `professionalProfileId` is never accepted from the caller —
 * it is always re-derived from the authenticated `userId` via
 * `ProfessionalRepository.findByUserId`, the identical "never trust a
 * client-supplied ownership id" pattern GetProfessionalEarningsUseCase
 * already uses. A user with no professional profile gets a
 * ValidationError, never another professional's data; there is no code
 * path here that can return a different professional's analytics than the
 * caller's own.
 *
 * Financial figures come from Module 22's own GetProfessionalEarningsUseCase
 * — see ProfessionalAnalyticsSummaryDTO's `earnings` field doc comment for
 * the exact reuse boundary and the settlement-date filtering caveat.
 */
export class GetProfessionalAnalyticsSummaryUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly analytics: ProfessionalAnalyticsRepository,
    private readonly reviews: ReviewRepository,
    private readonly professionalEarnings: GetProfessionalEarningsUseCase,
  ) {}

  async execute(userId: string, input: AnalyticsDateRangeInput): Promise<ProfessionalAnalyticsSummaryDTO> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("You must have a professional profile to view analytics.");
    }

    const resolved = resolveAnalyticsDateRange(input);
    const isRanged = Boolean(resolved.from || resolved.to);

    const [summary, rating, allEarnings] = await Promise.all([
      this.analytics.getSummary(professional.id, resolved),
      this.reviews.getProfessionalRatingSummary(professional.id),
      this.professionalEarnings.execute(userId),
    ]);

    const earningsInScope = isRanged
      ? allEarnings.filter((e) => {
          if (!e.settledAt) return false;
          const t = e.settledAt.getTime();
          if (resolved.from && t < resolved.from.getTime()) return false;
          if (resolved.to && t > resolved.to.getTime()) return false;
          return true;
        })
      : allEarnings;

    const totalCommission = roundToCents(earningsInScope.reduce((sum, e) => sum + e.professionalCommission, 0));
    const totalNetEarnings = roundToCents(earningsInScope.reduce((sum, e) => sum + e.professionalTotalNetEarnings, 0));

    return {
      range: { from: resolved.from, to: resolved.to },
      requestsRespondedTo: summary.requestsRespondedTo,
      quotes: {
        submitted: summary.quotesSubmitted,
        accepted: summary.quotesAccepted,
        rejected: summary.quotesRejected,
        acceptanceRate: safeRatio(summary.quotesAccepted, summary.quotesSubmitted),
      },
      bookings: {
        received: summary.bookingsReceived,
        confirmed: summary.bookingsConfirmed,
        completed: summary.bookingsCompleted,
        cancelled: summary.bookingsCancelled,
      },
      jobs: {
        completed: summary.jobsCompleted,
        cancelled: summary.jobsCancelled,
        completionRate: safeRatio(summary.jobsCompleted, summary.jobsCompleted + summary.jobsCancelled),
      },
      rating: {
        average: rating.averageRating,
        reviewCount: rating.reviewCount,
      },
      portfolioItemCount: summary.portfolioItemCount,
      earnings: {
        totalCommission,
        totalNetEarnings,
        settledJobCount: earningsInScope.length,
      },
    };
  }
}
