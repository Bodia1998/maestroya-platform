import type { LeadQualityClaimDTO } from "@/application/dto/lead-quality-claim.dto";
import { toLeadQualityClaimDto } from "@/application/dto/lead-quality-claim.dto";
import { assertAuthorizedClaimAdmin, assertNotOwnClaim } from "@/application/use-cases/lead-quality-claim/lead-quality-claim-support";
import type { AdminRepository } from "@/domain/repositories/admin-repository";
import type { LeadQualityClaimRepository } from "@/domain/repositories/lead-quality-claim-repository";
import {
  LeadQualityClaimRejectedError,
  canTransitionLeadQualityClaim,
  isLeadQualityClaimDecision,
  isLeadQualityClaimUuid,
  normalizeLeadQualityClaimDecisionExplanation,
  type LeadQualityClaimDecision,
} from "@/domain/services/lead-quality-claim";

export interface DecideLeadQualityClaimInput {
  claimId: string;
  decision: LeadQualityClaimDecision;
  /** Mandatory for BOTH approval and rejection. */
  explanation: string;
}

/**
 * Module 154 — an administrator APPROVES or REJECTS an open claim, with a mandatory explanation.
 *
 * This records a DECISION only. It does not refund, call the Module 153 refund use case, a payment gateway, the ledger, invoices or
 * credit notes, and it does not change the purchase: its result never says money moved. Approval of a claim is NOT a completed refund.
 *
 * Authorization is enforced here (admin re-read through `AdminRepository` on every call). Valid transitions are only
 * SUBMITTED|UNDER_REVIEW -> APPROVED|REJECTED; a decided claim (APPROVED or REJECTED, including a repeat of the same decision) is
 * rejected (INVALID_TRANSITION). The write is status-conditional, so when two decisions race exactly one wins, and it is made in ONE
 * transaction with its audit entry (a failing audit write rolls the decision back). An admin never decides a claim of their OWN profile.
 */
export class DecideLeadQualityClaimUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly claims: LeadQualityClaimRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actorUserId: string, input: DecideLeadQualityClaimInput): Promise<LeadQualityClaimDTO> {
    // Pure validation first, then the actor (re-read), then state.
    if (!isLeadQualityClaimDecision(input?.decision)) throw new LeadQualityClaimRejectedError("INVALID_INPUT");
    const explanation = normalizeLeadQualityClaimDecisionExplanation(input.explanation);
    const actorId = await assertAuthorizedClaimAdmin(this.admins, actorUserId);
    if (!isLeadQualityClaimUuid(input.claimId)) throw new LeadQualityClaimRejectedError("CLAIM_NOT_FOUND");

    const current = await this.claims.findById(input.claimId.trim());
    if (!current) throw new LeadQualityClaimRejectedError("CLAIM_NOT_FOUND");
    await assertNotOwnClaim(this.claims, current.id, actorId); // before any state answer: nothing about the claim leaks to its owner
    if (!canTransitionLeadQualityClaim(current.status, input.decision)) throw new LeadQualityClaimRejectedError("INVALID_TRANSITION");

    const updated = await this.claims.decide(current.id, { to: input.decision, actorUserId: actorId, explanation, at: this.now() });
    if (!updated) throw new LeadQualityClaimRejectedError("INVALID_TRANSITION"); // a concurrent decision won

    return toLeadQualityClaimDto(updated);
  }
}
