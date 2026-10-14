import type { AdminRepository } from "@/domain/repositories/admin-repository";
import type { LeadPricingReviewRepository } from "@/domain/repositories/lead-pricing-review-repository";
import { REVIEWED_PRICING_FLOW_VERSION, priceReviewedJobValue } from "@/domain/services/lead-calibrated-estimate";
import { LeadAdminConsoleRejectedError, normalizeLeadAdminPage } from "@/domain/services/lead-admin-console";
import {
  LEAD_PRICING_REVIEW_STATUSES,
  LeadPricingReviewRejectedError,
  canDecideLeadPricingReview,
  isLeadPricingReviewUuid,
  isReviewableAdmin,
  normalizeLeadPricingReviewDecision,
  type LeadPricingReviewRecord,
  type LeadPricingReviewStatus,
} from "@/domain/services/lead-pricing-review";
import type { RegionalCalibrationResolution } from "@/domain/services/lead-regional-calibration";

/**
 * Module 164 — administrator use cases of the lead pricing review path.
 *
 * Authorization is enforced HERE, exactly like the M154/M155/M156/M157 use cases: the administrator is re-read through
 * `AdminRepository.getUserById` on EVERY call (must exist, be ACTIVE and hold ADMIN or SUPER_ADMIN; a lookup failure denies),
 * so a caller that forgets its own role check still cannot read or decide. One generic rejection for every denial.
 *
 * What an administrator sees: ids, codes, the category slug, the two-digit province code, the confidence breakdown and the
 * calibration provenance. Never a customer's name, contact, address, request text or budget (decision D26: no contact display).
 * What an administrator decides: APPROVE with an average job VALUE, or REJECT. The price is always produced by the pure pricing
 * rules, not typed in. Neither decision publishes a lead.
 */
async function assertReviewAdmin(admins: Pick<AdminRepository, "getUserById">, actorUserId: unknown): Promise<string> {
  if (typeof actorUserId !== "string" || actorUserId.trim() === "") throw new LeadPricingReviewRejectedError("ACTOR_NOT_AUTHORIZED");
  const id = actorUserId.trim();
  let actor;
  try {
    actor = await admins.getUserById(id);
  } catch {
    throw new LeadPricingReviewRejectedError("ACTOR_NOT_AUTHORIZED");
  }
  if (!isReviewableAdmin(actor)) throw new LeadPricingReviewRejectedError("ACTOR_NOT_AUTHORIZED");
  return id;
}

export interface ListLeadPricingReviewsInput {
  status?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export class ListLeadPricingReviewsUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly reviews: Pick<LeadPricingReviewRepository, "list">,
  ) {}

  async execute(actorUserId: string, input: ListLeadPricingReviewsInput = {}): Promise<LeadPricingReviewRecord[]> {
    await assertReviewAdmin(this.admins, actorUserId);
    let status: LeadPricingReviewStatus | null = "PENDING_REVIEW";
    if (input.status === null) status = null;
    else if (input.status !== undefined) {
      if (typeof input.status !== "string" || !(LEAD_PRICING_REVIEW_STATUSES as readonly string[]).includes(input.status)) throw new LeadPricingReviewRejectedError("INVALID_INPUT");
      status = input.status as LeadPricingReviewStatus;
    }
    let page;
    try {
      page = normalizeLeadAdminPage({ limit: input.limit, offset: input.offset });
    } catch (error) {
      if (error instanceof LeadAdminConsoleRejectedError) throw new LeadPricingReviewRejectedError("INVALID_INPUT");
      throw error;
    }
    return this.reviews.list({ status, limit: page.limit, offset: page.offset });
  }
}

export class GetLeadPricingReviewUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly reviews: Pick<LeadPricingReviewRepository, "findById">,
  ) {}

  async execute(actorUserId: string, reviewId: unknown): Promise<LeadPricingReviewRecord> {
    await assertReviewAdmin(this.admins, actorUserId);
    if (!isLeadPricingReviewUuid(reviewId)) throw new LeadPricingReviewRejectedError("INVALID_INPUT");
    const review = await this.reviews.findById(reviewId.trim().toLowerCase());
    if (!review) throw new LeadPricingReviewRejectedError("REVIEW_NOT_FOUND");
    return review;
  }
}

export class DecideLeadPricingReviewUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly reviews: Pick<LeadPricingReviewRepository, "findById" | "decide">,
    /** The calibration the pipeline currently runs. A review made under a different release is stale and cannot be decided. */
    private readonly calibration: RegionalCalibrationResolution,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actorUserId: string, reviewId: unknown, rawDecision: unknown): Promise<LeadPricingReviewRecord> {
    const actor = await assertReviewAdmin(this.admins, actorUserId);
    if (!isLeadPricingReviewUuid(reviewId)) throw new LeadPricingReviewRejectedError("INVALID_INPUT");
    const decision = normalizeLeadPricingReviewDecision(rawDecision);
    const id = reviewId.trim().toLowerCase();

    const current = await this.reviews.findById(id);
    if (!current) throw new LeadPricingReviewRejectedError("REVIEW_NOT_FOUND");

    if (!canDecideLeadPricingReview(current.status)) return this.repeatOrRefuse(current, decision);

    if (decision.outcome === "APPROVED") {
      if (this.calibration.status !== "VALID") throw new LeadPricingReviewRejectedError("CONFIGURATION_UNAVAILABLE");
      if (this.calibration.config.calibrationVersion !== current.calibrationVersion) throw new LeadPricingReviewRejectedError("REVIEW_STALE");
      // The value must be priceable by the SAME rules the publication will use; otherwise an approval would only fail later.
      const priced = priceReviewedJobValue(
        {
          flowVersion: REVIEWED_PRICING_FLOW_VERSION,
          categorySlug: current.categorySlug,
          parentCategorySlug: current.parentCategorySlug,
          region: { status: "RESOLVED", provinceCode: current.provinceCode },
          reviewedJobValue: decision.reviewedJobValue,
          reviewId: current.id,
          reviewReasons: current.reasonCodes,
        },
        this.calibration.config,
      );
      if (priced.status !== "PRICED") throw new LeadPricingReviewRejectedError("VALUE_NOT_PRICEABLE");
    }

    const updated = await this.reviews.decide(current.id, decision, actor, this.now());
    if (updated) return updated;

    // A concurrent decision won the conditional write: report it as a repeat, or refuse.
    const winner = await this.reviews.findById(current.id);
    if (!winner) throw new LeadPricingReviewRejectedError("REVIEW_NOT_FOUND");
    return this.repeatOrRefuse(winner, decision);
  }

  /** The same outcome again is an idempotent repeat (no second write); a different one is refused. A decided row is final. */
  private repeatOrRefuse(current: LeadPricingReviewRecord, decision: ReturnType<typeof normalizeLeadPricingReviewDecision>): LeadPricingReviewRecord {
    if (decision.outcome === "REJECTED" && current.status === "REJECTED") return current;
    if (decision.outcome === "APPROVED" && current.status === "APPROVED" && current.reviewedJobValue !== null && sameMoney(current.reviewedJobValue, decision.reviewedJobValue)) {
      return current;
    }
    throw new LeadPricingReviewRejectedError("ALREADY_DECIDED");
  }
}

function sameMoney(a: string, b: string): boolean {
  const norm = (v: string) => {
    const [whole = "0", frac = ""] = v.split(".");
    return `${BigInt(whole)}.${frac.padEnd(2, "0")}`;
  };
  return norm(a) === norm(b);
}
