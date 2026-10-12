import type { LeadFeeDisputeGateway } from "@/application/ports/lead-fee-dispute-gateway";
import { PaymentGatewayError } from "@/domain/errors/domain-error";
import type { AdminRepository } from "@/domain/repositories/admin-repository";
import {
  LeadFeeDisputeEvidenceConflictError,
  type LeadFeeDisputeRecord,
  type LeadFeeDisputeRepository,
} from "@/domain/repositories/lead-fee-dispute-repository";
import {
  LeadFeeDisputeRejectedError,
  leadFeeDisputeEvidenceIdempotencyKey,
  mapProviderDisputeStatus,
  type LeadFeeDisputeEvidenceConfig,
  type LeadFeeProviderDisputeState,
} from "@/domain/services/lead-fee-dispute";
import { isDefinitiveLeadFeeRefundRejection } from "@/domain/services/lead-fee-refund";
import { assertLeadFeeDisputeAdminActor } from "@/application/use-cases/lead-fee-dispute/assert-lead-fee-dispute-actor";
import { normalizeAdminText, normalizeEvidenceReference, normalizeId } from "@/application/use-cases/lead-fee-dispute/normalize-lead-fee-dispute-input";
import { logger } from "@/infrastructure/observability/logger";

export interface SubmitLeadFeeDisputeEvidenceInput {
  actorUserId: string;
  /** MaestroYa's dispute-record id (not the provider's). */
  disputeId: string;
  /** Plain-text evidence, 1..1000 characters. The CALLER supplies it; nothing is generated from customer or contact data. */
  evidenceText: string;
  /** Opaque incident / evidence reference. */
  evidenceReference: string;
}

export interface SubmitLeadFeeDisputeEvidenceResult {
  disputeId: string;
  /** SUBMITTED only when the submission is established at the provider. SUBMISSION_PENDING = unresolved: re-run to reconcile. */
  evidenceStatus: LeadFeeDisputeRecord["evidenceStatus"];
}

/**
 * Module 155 — BASIC evidence submission for an open dispute. TRUSTED-INTERNAL, admin-initiated and OFF unless the switch
 * `LEAD_FEE_DISPUTE_EVIDENCE_SUBMISSION_ENABLED` is exactly "true" (read on EVERY call; any other non-empty value blocks). A
 * submission is a real, FINAL provider write, so:
 *  - the dispute must be NEEDS_RESPONSE in our records AND at the provider (same payment, not past due, no earlier submission);
 *  - the claim (NOT_SUBMITTED -> SUBMISSION_PENDING, with actor / reference / text) is persisted and audited BEFORE the provider call;
 *  - the provider call uses a deterministic idempotency key; a definitive provider rejection releases the claim (controlled retry),
 *    while an unknown outcome (timeout / 5xx) leaves it PENDING and a re-run first READS the provider: an earlier submission is
 *    recorded as SUBMITTED, none means the same request is replayed with the same key;
 *  - only text is sent: no file, no customer / contact data is read or attached by this module.
 * It never accepts, closes or concedes a dispute and moves no money. The provider semantics used here (retrieve fields, one
 * submission) are NOT verified against a test-mode rehearsal; every unrecognised answer fails closed.
 */
export class SubmitLeadFeeDisputeEvidenceUseCase {
  constructor(
    private readonly disputes: LeadFeeDisputeRepository,
    private readonly gateway: LeadFeeDisputeGateway,
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly getConfig: () => LeadFeeDisputeEvidenceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: SubmitLeadFeeDisputeEvidenceInput): Promise<SubmitLeadFeeDisputeEvidenceResult> {
    const actorUserId = normalizeId(input?.actorUserId);
    const disputeId = normalizeId(input?.disputeId);
    const evidenceText = normalizeAdminText(input?.evidenceText);
    const evidenceReference = normalizeEvidenceReference(input?.evidenceReference);

    const config = this.getConfig();
    if (config.status !== "VALID") throw new LeadFeeDisputeRejectedError("CONFIG_INVALID");
    if (!config.submissionEnabled) throw new LeadFeeDisputeRejectedError("SWITCH_DISABLED");

    await assertLeadFeeDisputeAdminActor(this.admins, actorUserId);

    let record = await this.disputes.findById(disputeId);
    if (!record) throw new LeadFeeDisputeRejectedError("DISPUTE_NOT_FOUND");
    if (record.evidenceStatus === "SUBMITTED") return { disputeId, evidenceStatus: "SUBMITTED" };
    if (record.status !== "NEEDS_RESPONSE") throw new LeadFeeDisputeRejectedError("EVIDENCE_NOT_ALLOWED");

    // The provider is the authority on whether evidence can still be sent.
    const state = await this.readProviderState(record);
    this.assertProviderAllowsEvidence(record, state);

    if (record.evidenceStatus === "SUBMISSION_PENDING") {
      // An earlier run claimed the submission and its outcome is unknown. Never re-send blindly: the provider says what happened.
      if (state.evidenceSubmissionCount > 0) {
        record = await this.disputes.markEvidenceSubmitted(record.id, record.evidenceActorUserId ?? actorUserId, this.now());
        return { disputeId, evidenceStatus: record.evidenceStatus };
      }
    } else {
      try {
        record = await this.disputes.claimEvidenceSubmission({ disputeId: record.id, actorUserId, evidenceReference, evidenceText, now: this.now() });
      } catch (error) {
        if (error instanceof LeadFeeDisputeEvidenceConflictError) throw new LeadFeeDisputeRejectedError("EVIDENCE_NOT_ALLOWED");
        throw error;
      }
    }

    // The claimed text (not the caller's retry text) is what is sent, so a re-run is byte-identical.
    const textToSend = record.evidenceText ?? evidenceText;
    try {
      await this.gateway.submitEvidence({
        providerDisputeId: record.providerDisputeId,
        evidenceText: textToSend,
        leadFeeDisputeId: record.id,
        idempotencyKey: leadFeeDisputeEvidenceIdempotencyKey(record.id),
      });
    } catch (error) {
      if (error instanceof PaymentGatewayError && isDefinitiveLeadFeeRefundRejection(error.category)) {
        await this.disputes.releaseEvidenceClaim(record.id);
        logger.warn("lead_fee_dispute.evidence_rejected_by_provider", { disputeRecordId: record.id, category: error.category });
        throw new LeadFeeDisputeRejectedError("PROVIDER_MISMATCH");
      }
      // Unknown outcome: the claim stays SUBMISSION_PENDING; a re-run reads the provider before doing anything.
      logger.error("lead_fee_dispute.evidence_outcome_unknown", {
        disputeRecordId: record.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      return { disputeId, evidenceStatus: "SUBMISSION_PENDING" };
    }

    const submitted = await this.disputes.markEvidenceSubmitted(record.id, record.evidenceActorUserId ?? actorUserId, this.now());
    return { disputeId, evidenceStatus: submitted.evidenceStatus };
  }

  private async readProviderState(record: LeadFeeDisputeRecord): Promise<LeadFeeProviderDisputeState> {
    try {
      return await this.gateway.retrieveDispute(record.providerDisputeId);
    } catch {
      throw new LeadFeeDisputeRejectedError("PROVIDER_UNAVAILABLE");
    }
  }

  private assertProviderAllowsEvidence(record: LeadFeeDisputeRecord, state: LeadFeeProviderDisputeState): void {
    if (state.providerDisputeId !== record.providerDisputeId || state.paymentReference !== record.paymentReference) {
      throw new LeadFeeDisputeRejectedError("PROVIDER_MISMATCH");
    }
    // `created`-type mapping is used on purpose: only an OPEN, response-needing status may receive evidence.
    if (mapProviderDisputeStatus("charge.dispute.updated", state.rawStatus) !== "NEEDS_RESPONSE") throw new LeadFeeDisputeRejectedError("EVIDENCE_NOT_ALLOWED");
    if (state.pastDue) throw new LeadFeeDisputeRejectedError("EVIDENCE_NOT_ALLOWED");
  }
}
