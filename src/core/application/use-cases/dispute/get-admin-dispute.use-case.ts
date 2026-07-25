import { NotFoundError } from "@/domain/errors/domain-error";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { DisputeMessageRecord, DisputeMessageRepository } from "@/domain/repositories/dispute-message-repository";
import type { DisputeEvidenceRecord, DisputeEvidenceRepository } from "@/domain/repositories/dispute-evidence-repository";

export interface AdminDisputeDetail {
  dispute: DisputeRecord;
  /** Every message INCLUDING internal notes — admin-only. */
  messages: DisputeMessageRecord[];
  evidence: DisputeEvidenceRecord[];
}

/**
 * Module 21 — Disputes & Support: admin detail view — the only place in
 * this module that calls `disputeMessages.listAll` (public thread +
 * internal notes together). Trusts the caller has already been authorized
 * via `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action
 * boundary, same convention as GetAdminUserUseCase/GetAdminJobUseCase.
 * NEVER call this use case, or `disputeMessages.listAll`, from a
 * non-admin-authorized code path — see DisputeMessageRepository's own doc
 * comment for why this is the security-critical boundary for internal
 * notes.
 */
export class GetAdminDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly disputeMessages: DisputeMessageRepository,
    private readonly disputeEvidence: DisputeEvidenceRepository,
  ) {}

  async execute(disputeId: string): Promise<AdminDisputeDetail> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    const [messages, evidence] = await Promise.all([
      this.disputeMessages.listAll(dispute.id),
      this.disputeEvidence.listByDisputeId(dispute.id),
    ]);

    return { dispute, messages, evidence };
  }
}
