import { NotFoundError } from "@/domain/errors/domain-error";
import { LeadPublished } from "@/domain/events/lead-published";
import type { EventBus } from "@/application/ports/event-bus";
import { logger } from "@/infrastructure/observability/logger";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { LeadPublicationPriceSource } from "@/application/ports/lead-publication-price-source";
import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { LeadNotPublishableError, assertLeadEligibleFlow } from "@/domain/services/lead";
import {
  LeadPublicationRejectedError,
  assertLeadPublicationEligible,
  assertValidLeadPublicationSnapshotData,
  buildLeadPublicationSnapshotData,
  evaluateLeadPublicationPricing,
  isValidLeadBuyerPolicy,
  type LeadBuyerPolicy,
} from "@/domain/services/lead-publication";

/**
 * Module 124/133 — publishes a DRAFT Lead (DRAFT -> PUBLISHED) under the
 * LEAD_V1 publication contract (see domain/services/lead-publication.ts).
 *
 * `userId` must come from the server-side session; only the owning customer
 * may publish. A Lead that is missing or not yours is the same NotFoundError.
 *
 * Order: ownership -> LEAD_V1 flow -> idempotent PUBLISHED repeat -> DRAFT +
 * open/complete/non-deleted request (publication eligibility) -> explicit
 * buyer policy -> production price outcome through the priceability gate ->
 * snapshot -> ONE conditional write of status + snapshot.
 *
 * - Anything unpriceable (UNPRICED, unsupported category, low confidence,
 *   missing/invalid configuration, malformed result) or an invalid buyer
 *   policy throws LeadPublicationRejectedError. The Lead stays DRAFT and the
 *   publication can be retried later; nothing partial is written.
 * - Idempotent: an already-PUBLISHED Lead is returned unchanged — its original
 *   snapshot and buyer policy are NEVER recomputed or overwritten, and the
 *   price source is not even consulted.
 * - CLOSED / EXPIRED / CANCELLED Leads are rejected (LeadNotPublishableError).
 * - Concurrent publishes: the repository write is conditional on DRAFT, so the
 *   first snapshot wins; the loser re-reads and returns the winner's record.
 *
 * Publishing exposes no contact data and creates no financial record. It
 * enforces no purchase limit (that is M135/M137).
 *
 * Module 145: when (and only when) THIS call won the conditional DRAFT -> PUBLISHED write, it
 * raises `LeadPublished` (id only) so the customer is notified. An idempotent repeat or a lost race
 * raises nothing. Notification is best-effort: a failing subscriber is logged and never fails or
 * rolls back the publication. `events` is optional so every pre-M145 construction is unchanged.
 */
export class PublishLeadUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly leads: LeadRepository,
    private readonly priceSource: LeadPublicationPriceSource,
    private readonly buyerPolicy: LeadBuyerPolicy,
    private readonly events?: Pick<EventBus, "publish">,
  ) {}

  async execute(userId: string, leadId: string): Promise<LeadRecord> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) throw new NotFoundError("Lead", leadId);

    const lead = await this.leads.findById(leadId);
    if (!lead) throw new NotFoundError("Lead", leadId);

    const request = await this.serviceRequests.findById(lead.serviceRequestId);
    if (!request || request.customerId !== customer.id) throw new NotFoundError("Lead", leadId);

    assertLeadEligibleFlow(lead.flowVersion);

    // Idempotent repeat: never touch (or re-derive) an existing snapshot.
    if (lead.status === "PUBLISHED") return lead;

    assertLeadPublicationEligible({ leadStatus: lead.status, flowVersion: lead.flowVersion, request });

    if (!isValidLeadBuyerPolicy(this.buyerPolicy)) throw new LeadPublicationRejectedError("BUYER_POLICY_INVALID");

    const evaluation = evaluateLeadPublicationPricing(await this.priceSource.priceForLead(leadId));
    if (!evaluation.ok) throw new LeadPublicationRejectedError(evaluation.reason);

    const snapshot = buildLeadPublicationSnapshotData(evaluation.pricing, this.buyerPolicy);
    assertValidLeadPublicationSnapshotData(snapshot);

    const published = await this.leads.publish(leadId, snapshot);
    if (published) {
      await this.announcePublication(leadId);
      return published;
    }

    // Lost a race (or the lead/request changed after our read): re-read to
    // tell an idempotent repeat from a rejected publication.
    const current = await this.leads.findById(leadId);
    if (!current) throw new NotFoundError("Lead", leadId);
    if (current.status === "PUBLISHED") return current;
    throw new LeadNotPublishableError(current.status);
  }

  private async announcePublication(leadId: string): Promise<void> {
    if (!this.events) return;
    try {
      await this.events.publish(new LeadPublished(leadId));
    } catch (error) {
      logger.error("lead_publication.notification_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
}
