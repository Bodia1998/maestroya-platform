import type { ReferralVisitRepository, TopCampaignStat, TopReferralCodeStat } from "@/domain/repositories/referral-visit-repository";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { ConversionEventRepository } from "@/domain/repositories/conversion-event-repository";

/**
 * Module 60 — Referral & Marketing Attribution Platform: the reporting
 * projection consumed by both `scripts/run-referral-report.ts` and any
 * future admin dashboard. Pure aggregation over the three repositories —
 * no business rule of its own beyond "divide by zero is 0, not NaN/Infinity"
 * (see `rate`).
 *
 * Funnel definition: visits -> registrations -> bookings created ->
 * bookings completed. Each conversion rate below is relative to the
 * *previous* funnel stage (e.g. `registrationToBookingRate` = bookings
 * created / registrations), not relative to total visits — this matches
 * how a marketer reads a funnel report (where does the biggest drop-off
 * happen) rather than a single blended number that would hide it.
 */
export interface ReferralStatistics {
  totalVisits: number;
  totalAttributedVisitors: number;
  totalRegisteredVisitors: number;
  topReferralCodes: TopReferralCodeStat[];
  topCampaigns: TopCampaignStat[];
  registrations: number;
  professionalRegistrations: number;
  clientRegistrations: number;
  bookingsCreated: number;
  bookingsCompleted: number;
  commissionsGenerated: number;
  revenueAttributedTotal: number;
  visitToRegistrationRate: number;
  registrationToBookingRate: number;
  bookingCompletionRate: number;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

export class GetReferralStatisticsUseCase {
  constructor(
    private readonly visits: ReferralVisitRepository,
    private readonly attributions: MarketingAttributionRepository,
    private readonly conversions: ConversionEventRepository,
    private readonly topN: number = 10,
  ) {}

  async execute(): Promise<ReferralStatistics> {
    const [
      totalVisits,
      totalAttributedVisitors,
      totalRegisteredVisitors,
      topReferralCodes,
      topCampaigns,
      registrations,
      professionalRegistrations,
      clientRegistrations,
      bookingsCreated,
      bookingsCompleted,
      commissionsGenerated,
      revenueBooking,
      revenueCommission,
    ] = await Promise.all([
      this.visits.countAll(),
      this.attributions.countTotal(),
      this.attributions.countWithUser(),
      this.visits.topReferralCodesByVisits(this.topN),
      this.visits.topCampaignsByVisits(this.topN),
      this.conversions.countByType("REGISTRATION"),
      this.conversions.countByType("PROFESSIONAL_REGISTRATION"),
      this.conversions.countByType("CLIENT_REGISTRATION"),
      this.conversions.countByType("BOOKING_CREATED"),
      this.conversions.countByType("BOOKING_COMPLETED"),
      this.conversions.countByType("COMMISSION_GENERATED"),
      this.conversions.sumRevenueByType("BOOKING_COMPLETED"),
      this.conversions.sumRevenueByType("COMMISSION_GENERATED"),
    ]);

    return {
      totalVisits,
      totalAttributedVisitors,
      totalRegisteredVisitors,
      topReferralCodes,
      topCampaigns,
      registrations,
      professionalRegistrations,
      clientRegistrations,
      bookingsCreated,
      bookingsCompleted,
      commissionsGenerated,
      revenueAttributedTotal: revenueBooking + revenueCommission,
      visitToRegistrationRate: rate(registrations, totalVisits),
      registrationToBookingRate: rate(bookingsCreated, registrations),
      bookingCompletionRate: rate(bookingsCompleted, bookingsCreated),
    };
  }
}
