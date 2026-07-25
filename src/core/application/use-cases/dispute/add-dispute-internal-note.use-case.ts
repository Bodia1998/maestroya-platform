import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { DisputeMessageRecord, DisputeMessageRepository } from "@/domain/repositories/dispute-message-repository";

/**
 * Module 21 — Disputes & Support: adds an admin-only internal note to a
 * Dispute — the ONLY place `isInternalNote: true` is ever written.
 * Admin-only — trusts the caller has already been authorized via
 * `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action boundary,
 * same convention as every other admin-only use case in this codebase.
 *
 * SECURITY-CRITICAL: there is no client input anywhere in this class that
 * could make it write `isInternalNote: false` — the hardcoded `true` below
 * is the entire enforcement of "an internal note is never mistakenly
 * public". See DisputeMessageRepository's own doc comment for the other
 * half of this invariant (that `listPublic`, used by every non-admin read
 * path, never returns these rows).
 */
export class AddDisputeInternalNoteUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly disputeMessages: DisputeMessageRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, disputeId: string, body: string): Promise<DisputeMessageRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    const note = await this.disputeMessages.create({
      disputeId,
      authorUserId: adminUserId,
      body,
      isInternalNote: true,
    });

    try {
      await this.auditLog.record({
        adminUserId,
        action: "DISPUTE_INTERNAL_NOTE_ADDED",
        targetType: "Dispute",
        targetId: disputeId,
        metadata: { noteId: note.id },
      });
    } catch (error) {
      console.error("Failed to record dispute-internal-note-added audit log", error);
    }

    return note;
  }
}
