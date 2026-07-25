import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AnalyticsRange,
  ProfessionalAnalyticsRepository,
  ProfessionalAnalyticsSummaryCounts,
} from "@/domain/repositories/analytics-repository";

function dateFilter(range: AnalyticsRange) {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

/**
 * Module 23 — Analytics: a single professional's own activity summary.
 * `professionalProfileId` here is always resolved server-side by the
 * calling use case from the authenticated user (see
 * GetProfessionalAnalyticsSummaryUseCase) — this repository has no notion
 * of "whose analytics is this" beyond the id it's given, the same
 * boundary CommissionRepository.listForProfessional already draws.
 *
 * Every query below is scoped `WHERE professionalProfileId = :id` on an
 * indexed column (see the `@@index([professionalProfileId, status])`
 * indexes already present on Job/Appointment/Quote/Commission in
 * schema.prisma) — result sizes are bounded by this one professional's own
 * record count, not the platform's.
 */
export class PrismaProfessionalAnalyticsRepository implements ProfessionalAnalyticsRepository {
  async getSummary(professionalProfileId: string, range: AnalyticsRange): Promise<ProfessionalAnalyticsSummaryCounts> {
    const createdAt = dateFilter(range);
    const quoteWhere = { professionalProfileId, ...(createdAt ? { createdAt } : {}) };
    const appointmentWhere = { professionalProfileId, ...(createdAt ? { createdAt } : {}) };
    const jobWhere = { professionalProfileId, ...(createdAt ? { createdAt } : {}) };

    const [
      requestsRespondedToGroups,
      quotesSubmitted,
      quotesAccepted,
      quotesRejected,
      bookingsReceived,
      bookingsConfirmed,
      bookingsCompleted,
      bookingsCancelled,
      jobsCompleted,
      jobsCancelled,
      portfolioItemCount,
    ] = await Promise.all([
      prisma.quote.groupBy({ by: ["serviceRequestId"], where: quoteWhere }),
      prisma.quote.count({ where: quoteWhere }),
      prisma.quote.count({ where: { ...quoteWhere, status: "ACCEPTED" } }),
      prisma.quote.count({ where: { ...quoteWhere, status: "REJECTED" } }),
      prisma.appointment.count({ where: appointmentWhere }),
      prisma.appointment.count({ where: { ...appointmentWhere, status: "CONFIRMED" } }),
      prisma.appointment.count({ where: { ...appointmentWhere, status: "COMPLETED" } }),
      prisma.appointment.count({ where: { ...appointmentWhere, status: "CANCELLED" } }),
      prisma.job.count({ where: { ...jobWhere, status: "COMPLETED" } }),
      prisma.job.count({ where: { ...jobWhere, status: "CANCELLED" } }),
      prisma.portfolioItem.count({ where: { professionalProfileId, deletedAt: null } }),
    ]);

    return {
      requestsRespondedTo: requestsRespondedToGroups.length,
      quotesSubmitted,
      quotesAccepted,
      quotesRejected,
      bookingsReceived,
      bookingsConfirmed,
      bookingsCompleted,
      bookingsCancelled,
      jobsCompleted,
      jobsCancelled,
      portfolioItemCount,
    };
  }
}
