import type { LeadQualityClaimDTO } from "@/application/dto/lead-quality-claim.dto";
import { toLeadQualityClaimDto } from "@/application/dto/lead-quality-claim.dto";
import { assertAuthorizedClaimAdmin, assertNotOwnClaim } from "@/application/use-cases/lead-quality-claim/lead-quality-claim-support";
import type { AdminRepository } from "@/domain/repositories/admin-repository";
import type { LeadQualityClaimRepository } from "@/domain/repositories/lead-quality-claim-repository";
import { LeadQualityClaimRejectedError, canTransitionLeadQualityClaim, isLeadQualityClaimUuid } from "@/domain/services/lead-quality-claim";

/**
 * Module 154 — an administrator marks a SUBMITTED claim as UNDER_REVIEW. Authorization is enforced HERE (the admin is re-read
 * through `AdminRepository` on every call: must exist, be ACTIVE and hold ADMIN/SUPER_ADMIN), not only by a caller.
 * Only SUBMITTED -> UNDER_REVIEW is possible; a repeat or a claim already under review / decided is rejected (INVALID_TRANSITION).
 * The conditional update is the arbiter when two admins race; it is written in ONE transaction with its audit entry (a failing audit
 * write rolls the transition back and the caller gets an error). An admin never reviews a claim of their OWN professional profile.
 */
export class StartLeadQualityClaimReviewUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly claims: LeadQualityClaimRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actorUserId: string, claimId: string): Promise<LeadQualityClaimDTO> {
    const actorId = await assertAuthorizedClaimAdmin(this.admins, actorUserId);
    if (!isLeadQualityClaimUuid(claimId)) throw new LeadQualityClaimRejectedError("CLAIM_NOT_FOUND");
    const current = await this.claims.findById(claimId.trim());
    if (!current) throw new LeadQualityClaimRejectedError("CLAIM_NOT_FOUND");
    await assertNotOwnClaim(this.claims, current.id, actorId); // before any state answer: nothing about the claim leaks to its owner
    if (!canTransitionLeadQualityClaim(current.status, "UNDER_REVIEW")) throw new LeadQualityClaimRejectedError("INVALID_TRANSITION");

    const updated = await this.claims.markReviewStarted(current.id, actorId, this.now());
    if (!updated) throw new LeadQualityClaimRejectedError("INVALID_TRANSITION"); // a concurrent move won

    return toLeadQualityClaimDto(updated);
  }
}
