import { NotFoundError } from "@/domain/errors/domain-error";
import { detectAllFraudSignals, type PartnerActivitySignal, type RegistrationOutcome } from "@/domain/services/affiliate-fraud-rules";
import type { ConversionEventRepository } from "@/domain/repositories/conversion-event-repository";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { PartnerFraudFlagRecord, PartnerFraudFlagRepository } from "@/domain/repositories/partner-fraud-flag-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import type { ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";
import type { ReferralVisitRepository } from "@/domain/repositories/referral-visit-repository";

/**
 * Module 61 — Affiliate & Partner System: runs every fraud rule in
 * `domain/services/affiliate-fraud-rules.ts` against one partner's real
 * activity (fetched from Module 60's repositories, reused as-is) and
 * persists any findings as `PartnerFraudFlag` rows for admin review — see
 * that repository's own doc comment for why flagging is always advisory,
 * never automatically punitive.
 */
export class DetectPartnerFraudSignalsUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly referralCodes: ReferralCodeRepository,
    private readonly visits: ReferralVisitRepository,
    private readonly attributions: MarketingAttributionRepository,
    private readonly conversions: ConversionEventRepository,
    private readonly fraudFlags: PartnerFraudFlagRepository,
  ) {}

  async execute(partnerId: string): Promise<PartnerFraudFlagRecord[]> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", partnerId);
    }

    const codes = (await this.referralCodes.findByOwnerUserId(partner.userId)).map((c) => c.code);
    const partnerVisits = await this.visits.listByReferralCodes(codes);
    const partnerAttributions = await this.attributions.listByReferralCodes(codes);
    const attributionByVisitorId = new Map(partnerAttributions.map((a) => [a.visitorId, a]));

    const signals: PartnerActivitySignal[] = partnerVisits.map((v) => ({
      referredUserId: attributionByVisitorId.get(v.visitorId)?.userId ?? null,
      visitorId: v.visitorId,
      ipHash: v.ipHash,
      userAgentTruncated: v.userAgentTruncated,
      occurredAt: v.createdAt,
    }));

    const registrationOutcomes: RegistrationOutcome[] = [];
    for (const attribution of partnerAttributions) {
      if (!attribution.userId) continue;
      const events = await this.conversions.listByAttributionId(attribution.id);
      const hasRegistration = events.some((e) => e.type === "REGISTRATION" || e.type === "PROFESSIONAL_REGISTRATION" || e.type === "CLIENT_REGISTRATION");
      if (!hasRegistration) continue;
      const becameActive = events.some((e) => e.type === "BOOKING_CREATED" || e.type === "BOOKING_COMPLETED");
      registrationOutcomes.push({ referredUserId: attribution.userId, becameActive });
    }

    const findings = detectAllFraudSignals(partner.userId, signals, registrationOutcomes);

    const created: PartnerFraudFlagRecord[] = [];
    for (const finding of findings) {
      created.push(
        await this.fraudFlags.create({
          partnerId: partner.id,
          type: finding.type,
          detail: finding.detail,
          relatedVisitorId: finding.relatedVisitorId,
          relatedUserId: finding.relatedUserId,
        }),
      );
    }
    return created;
  }
}
