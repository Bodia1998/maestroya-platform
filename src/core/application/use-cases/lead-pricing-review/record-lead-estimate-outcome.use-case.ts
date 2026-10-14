import type { AdminRepository } from "@/domain/repositories/admin-repository";
import type { LeadEstimateOutcomeRepository } from "@/domain/repositories/lead-estimate-outcome-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import {
  LeadEstimateOutcomeRejectedError,
  normalizeLeadEstimateOutcome,
  type LeadEstimateOutcomeRecord,
} from "@/domain/services/lead-estimate-outcome";
import { isLeadPricingReviewUuid, isReviewableAdmin } from "@/domain/services/lead-pricing-review";

/**
 * Module 164 — an administrator records the ACTUAL job value of a lead that was published with a price snapshot.
 *
 * Authorization is re-read on every call (ADMIN / SUPER_ADMIN, ACTIVE), like the other lead admin use cases. Only a lead that has a
 * publication snapshot can have an outcome (there must be an estimate to compare with). One outcome per lead and it is immutable:
 * recording the SAME value again is an idempotent repeat that returns the existing row; a different value is refused
 * (ALREADY_RECORDED) — evidence is not edited. No price is touched, nothing is re-priced, no financial row is read or written.
 */
export class RecordLeadEstimateOutcomeUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly leads: Pick<LeadRepository, "findById">,
    private readonly outcomes: LeadEstimateOutcomeRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actorUserId: string, leadId: unknown, rawOutcome: unknown): Promise<LeadEstimateOutcomeRecord> {
    if (typeof actorUserId !== "string" || actorUserId.trim() === "") throw new LeadEstimateOutcomeRejectedError("ACTOR_NOT_AUTHORIZED");
    let actor;
    try {
      actor = await this.admins.getUserById(actorUserId.trim());
    } catch {
      throw new LeadEstimateOutcomeRejectedError("ACTOR_NOT_AUTHORIZED");
    }
    if (!isReviewableAdmin(actor)) throw new LeadEstimateOutcomeRejectedError("ACTOR_NOT_AUTHORIZED");

    if (!isLeadPricingReviewUuid(leadId)) throw new LeadEstimateOutcomeRejectedError("INVALID_INPUT");
    const normalized = normalizeLeadEstimateOutcome(rawOutcome);
    const lead = await this.leads.findById(leadId.trim().toLowerCase());
    if (!lead) throw new LeadEstimateOutcomeRejectedError("LEAD_NOT_FOUND");
    if (!lead.publication) throw new LeadEstimateOutcomeRejectedError("LEAD_NOT_PUBLISHED");

    const { outcome } = await this.outcomes.record({
      leadId: lead.id,
      actualJobValue: normalized.actualJobValue,
      source: "ADMIN_RECORDED",
      recordedByUserId: actorUserId.trim(),
      recordedAt: this.now(),
      note: normalized.note,
    });
    if (!sameValue(outcome.actualJobValue, normalized.actualJobValue)) throw new LeadEstimateOutcomeRejectedError("ALREADY_RECORDED");
    return outcome;
  }
}

function sameValue(a: string, b: string): boolean {
  const norm = (v: string) => {
    const [whole = "0", frac = ""] = v.split(".");
    return `${BigInt(whole)}.${frac.padEnd(2, "0")}`;
  };
  return norm(a) === norm(b);
}
