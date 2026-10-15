import type { LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import { isLeadRequestCategorySupported, type LeadRequestCategoryPolicy } from "@/domain/services/lead-request-category-support";
import { selectNewRequestFlow, type NewRequestFlowDecision } from "@/domain/services/new-request-flow";
import { logger } from "@/infrastructure/observability/logger";

const EMPTY_POLICY: LeadRequestCategoryPolicy = { supportedSlugs: new Set<string>(), unsupportedSlugs: new Set<string>() };

/**
 * Module 165 - the ONE place that decides which flow a NEW customer service request starts in.
 *
 * It composes two existing authorities and owns no configuration of its own:
 *   - `readEntryOpen`: the M159 ENTRY rollout area (read on EVERY call, never cached);
 *   - `readPolicy`: the M132 pilot category policy (the same resolution the M142 category list and the M133 publication use).
 *
 * Fail-safe semantics (each one moves towards the pre-M165 behaviour, never towards LEAD_V1):
 *   - ENTRY closed (default / misconfigured / unreadable): LEGACY, and NOTHING else is read - not the category table, not the pilot
 *     configuration. With the rollout at its default this class is inert.
 *   - the pilot configuration cannot be resolved (throws or is invalid): no category is eligible, so LEGACY (the M142 rule).
 *   - the category is unknown or inactive: LEGACY (the legacy use case then reports its own validation error).
 *   - an infrastructure failure while reading categories is NOT swallowed: the caller fails ("creation failed") instead of guessing
 *     a flow, so an outage can neither strand an eligible customer in legacy nor create LEAD_V1 on a guess.
 *
 * Stateless and read-only: it never reads or writes a ServiceRequest, so it cannot change the flow of an existing request.
 */
export class NewRequestFlowSelector {
  constructor(
    private readonly categories: LeadRequestCategoryRepository,
    private readonly readPolicy: () => LeadRequestCategoryPolicy,
    private readonly readEntryOpen: () => boolean,
  ) {}

  /** The flow a new request for `categoryId` must be created in. */
  async forCategory(categoryId: string): Promise<NewRequestFlowDecision> {
    if (!this.entryOpen()) return selectNewRequestFlow({ entryOpen: false, categoryEligible: false });
    const category = await this.categories.findActiveById(categoryId);
    const eligible = category !== null && isLeadRequestCategorySupported(category, this.policy());
    return selectNewRequestFlow({ entryOpen: true, categoryEligible: eligible });
  }

  /**
   * The flow of the "new request" entry before a category is chosen: LEAD_V1 when the area is open and at least one active
   * category is eligible (so the lead form has something to offer), otherwise LEGACY.
   */
  async forEntry(): Promise<NewRequestFlowDecision> {
    if (!this.entryOpen()) return selectNewRequestFlow({ entryOpen: false, categoryEligible: false });
    const policy = this.policy();
    const all = await this.categories.listActive();
    return selectNewRequestFlow({ entryOpen: true, categoryEligible: all.some((c) => isLeadRequestCategorySupported(c, policy)) });
  }

  /**
   * Ids of the active categories that remain on the legacy path while the cutover is open (so the legacy form never offers a
   * category its own creation path would refuse). `null` = no restriction (area closed: pre-M165 behaviour, nothing was read).
   */
  async legacyCategoryIds(): Promise<ReadonlySet<string> | null> {
    if (!this.entryOpen()) return null;
    const policy = this.policy();
    const all = await this.categories.listActive();
    return new Set(all.filter((c) => !isLeadRequestCategorySupported(c, policy)).map((c) => c.id));
  }

  private entryOpen(): boolean {
    try {
      return this.readEntryOpen() === true;
    } catch {
      return false;
    }
  }

  private policy(): LeadRequestCategoryPolicy {
    try {
      return this.readPolicy();
    } catch (error) {
      try {
        logger.error("new_request_flow.policy_unreadable", { error: error instanceof Error ? error.name : "unknown" });
      } catch {
        // Logging must never decide the outcome.
      }
      return EMPTY_POLICY;
    }
  }
}
