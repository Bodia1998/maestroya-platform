import { NotFoundError, PartnerNotActiveError, ValidationError } from "@/domain/errors/domain-error";
import { isPartnerActiveForAffiliateActivity } from "@/domain/services/partner-approval-rules";
import { isValidReferralCampaignSource } from "@/domain/services/referral-campaign-source-rules";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import type { ReferralCodeRecord } from "@/domain/repositories/referral-code-repository";
import type { CreateReferralCodeUseCase } from "@/application/use-cases/referral/create-referral-code.use-case";

/**
 * Module 61 — Affiliate & Partner System: lets an `APPROVED` partner mint
 * a new referral link. Deliberately a thin wrapper around Module 60's own
 * `CreateReferralCodeUseCase` — this is the concrete meaning of "reuse the
 * existing attribution, referral code and conversion infrastructure": no
 * new code-generation, uniqueness-checking, or format-validation logic
 * exists in this module. The only thing this use case adds on top is the
 * partner-status gate (`isPartnerActiveForAffiliateActivity`) and always
 * setting `ownerUserId` to the partner's own `userId`, so
 * `ReferralCodeRepository.findByOwnerUserId` (added by this module) is the
 * one place a partner's whole link catalog can be read back from.
 *
 * A single partner may generate more than one code (e.g. one shared in a
 * Telegram channel for professionals, another shared on Instagram for
 * customers) — Module 60's `ConversionEvent.type` (PROFESSIONAL_REGISTRATION
 * vs CLIENT_REGISTRATION) is what distinguishes "who did this link bring
 * in," not a dedicated "link purpose" field on this module's side.
 */
export class GeneratePartnerReferralLinkUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly createReferralCode: CreateReferralCodeUseCase,
  ) {}

  async execute(input: { partnerId: string; code: string; label?: string; source?: string | null }): Promise<ReferralCodeRecord> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }
    if (!isPartnerActiveForAffiliateActivity(partner.status)) {
      throw new PartnerNotActiveError(partner.status);
    }
    if (input.source && !isValidReferralCampaignSource(input.source)) {
      throw new ValidationError(`Unknown campaign source "${input.source}".`);
    }

    return this.createReferralCode.execute({
      code: input.code,
      ownerUserId: partner.userId,
      label: input.label ?? partner.displayName,
      source: input.source ?? null,
    });
  }
}
