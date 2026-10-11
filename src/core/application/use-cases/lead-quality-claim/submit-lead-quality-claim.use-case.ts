import type { LeadQualityClaimDTO } from "@/application/dto/lead-quality-claim.dto";
import { toLeadQualityClaimDto } from "@/application/dto/lead-quality-claim.dto";
import {
  LeadQualityClaimInsertConflictError,
  type LeadQualityClaimRepository,
} from "@/domain/repositories/lead-quality-claim-repository";
import type { LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import {
  LEAD_QUALITY_CLAIM_MAX_OPEN_PER_PROFESSIONAL,
  LEAD_QUALITY_CLAIM_MAX_SUBMITTED_PER_PERIOD,
  LEAD_QUALITY_CLAIM_PROFESSIONAL_ACTIVE_STATUS,
  LeadQualityClaimRejectedError,
  isLeadQualityClaimReasonCode,
  isLeadQualityClaimUuid,
  leadQualityClaimPeriodStart,
  normalizeLeadQualityClaimDescription,
  normalizeLeadQualityClaimEvidenceReference,
  type LeadQualityClaimReasonCode,
} from "@/domain/services/lead-quality-claim";

export interface SubmitLeadQualityClaimInput {
  /** The only client-chosen references. Everything else (professional, lead, owner, money) comes from the session and the database. */
  leadPurchaseId: string;
  reasonCode: LeadQualityClaimReasonCode;
  description: string;
  /** Optional opaque evidence id. */
  evidenceReference?: string | null;
}

/**
 * Module 154 — a professional claims that a lead they bought was unusable (CONTACT_UNREACHABLE / CONTACT_INVALID / DUPLICATE_LEAD).
 *
 * Trust boundary: `sessionUserId` is the authenticated session user. The professional is resolved from it through the existing
 * `ProfessionalRepository.findByUserId`; a client never supplies a professional, lead or owner. A claim is accepted only for the
 * caller's OWN, CONFIRMED purchase, inside the 72-hour window after `confirmedAt` (decided by the database clock), once per purchase.
 *
 * No existence probing: no profile, an inactive profile, a missing purchase, someone else's purchase and a purchase that is not
 * CONFIRMED all produce the SAME rejection (PURCHASE_NOT_CLAIMABLE). Window, duplicate and limit rejections are only reachable by
 * the purchase's own, active professional.
 *
 * Limits (3 open, 10 per rolling 30 days) are pre-checked here for a clear answer, but the AUTHORITATIVE, concurrency-safe
 * enforcement is the database insert trigger (it serializes one professional's inserts with a row lock); a refusal there is mapped to the same codes.
 *
 * This use case records a claim ONLY. It never touches the purchase, never calls the refund use case or any payment gateway,
 * and a claim never implies a refund.
 */
export class SubmitLeadQualityClaimUseCase {
  constructor(
    private readonly professionals: Pick<ProfessionalRepository, "findByUserId">,
    private readonly purchases: Pick<LeadPurchaseRepository, "findById">,
    private readonly claims: LeadQualityClaimRepository,
    /** Only used for the ADVISORY duplicate / limit pre-checks. Never decides the claim window and is never stored. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(sessionUserId: string, input: SubmitLeadQualityClaimInput): Promise<LeadQualityClaimDTO> {
    // 1. Pure validation (no I/O).
    if (typeof sessionUserId !== "string" || sessionUserId.trim() === "") throw new LeadQualityClaimRejectedError("INVALID_INPUT");
    if (!isLeadQualityClaimReasonCode(input?.reasonCode)) throw new LeadQualityClaimRejectedError("INVALID_INPUT");
    if (!isLeadQualityClaimUuid(input?.leadPurchaseId)) throw new LeadQualityClaimRejectedError("PURCHASE_NOT_CLAIMABLE");
    const description = normalizeLeadQualityClaimDescription(input.description);
    const evidenceReference = normalizeLeadQualityClaimEvidenceReference(input.evidenceReference);

    // 2. Ownership and eligibility: one undifferentiated outcome.
    const professional = await this.professionals.findByUserId(sessionUserId.trim());
    if (!professional || professional.status !== LEAD_QUALITY_CLAIM_PROFESSIONAL_ACTIVE_STATUS) throw new LeadQualityClaimRejectedError("PURCHASE_NOT_CLAIMABLE");
    const purchase = await this.purchases.findById(input.leadPurchaseId.trim());
    if (!purchase || purchase.professionalProfileId !== professional.id || purchase.status !== "CONFIRMED" || !purchase.confirmedAt) {
      throw new LeadQualityClaimRejectedError("PURCHASE_NOT_CLAIMABLE");
    }

    // 3. Duplicate and limits (the caller owns this purchase, so these answers leak nothing). The 72-hour WINDOW is deliberately not
    //    decided here: the database stamps `submittedAt` from its own clock and enforces the window against that same instant.
    const precheckAt = this.now();
    if (await this.claims.findByLeadPurchaseId(purchase.id)) throw new LeadQualityClaimRejectedError("ALREADY_CLAIMED");
    if ((await this.claims.countOpenByProfessional(professional.id)) >= LEAD_QUALITY_CLAIM_MAX_OPEN_PER_PROFESSIONAL) {
      throw new LeadQualityClaimRejectedError("OPEN_CLAIM_LIMIT_REACHED");
    }
    if ((await this.claims.countSubmittedSince(professional.id, leadQualityClaimPeriodStart(precheckAt))) >= LEAD_QUALITY_CLAIM_MAX_SUBMITTED_PER_PERIOD) {
      throw new LeadQualityClaimRejectedError("PERIOD_CLAIM_LIMIT_REACHED");
    }

    // 4. Atomic insert (claim + SUBMITTED audit entry in one transaction): the unique index and the insert trigger are the final
    //    arbiters of duplicates, limits and the window. `submittedAt` / `respondBy` come from the database.
    let claim;
    try {
      claim = await this.claims.create(
        { leadPurchaseId: purchase.id, professionalProfileId: professional.id, reasonCode: input.reasonCode, description, evidenceReference },
        sessionUserId.trim(),
      );
    } catch (error) {
      if (error instanceof LeadQualityClaimInsertConflictError) throw new LeadQualityClaimRejectedError(error.reason);
      throw error;
    }

    return toLeadQualityClaimDto(claim);
  }
}
