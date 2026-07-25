/**
 * Module 21 — Disputes & Support: repository interface for the
 * DisputeMessage aggregate (a dispute's communication thread, including
 * admin-only internal notes — see schema.prisma's DisputeMessage doc
 * comment for why this is a dedicated model rather than reusing
 * Conversation/Message).
 *
 * SECURITY-CRITICAL invariant this interface is designed to make hard to
 * violate: `listPublic` NEVER returns a row with `isInternalNote = true`.
 * There is deliberately no generic `list(disputeId)` method that returns
 * everything — only `listPublic` (safe for any case participant) and
 * `listAll` (admin-only, must never be called from a non-admin-authorized
 * use case; see ListDisputeInternalNotesUseCase/GetDisputeByIdUseCase's own
 * doc comments for where the admin-only boundary is actually enforced).
 */

export interface DisputeMessageRecord {
  id: string;
  disputeId: string;
  authorUserId: string;
  body: string;
  isInternalNote: boolean;
  createdAt: Date;
}

export interface CreateDisputeMessageData {
  disputeId: string;
  authorUserId: string;
  body: string;
  isInternalNote: boolean;
}

export interface DisputeMessageRepository {
  create(data: CreateDisputeMessageData): Promise<DisputeMessageRecord>;
  /** Every non-internal message on the dispute, oldest first — safe for any
   *  case participant (customer, professional/company, admin). */
  listPublic(disputeId: string): Promise<DisputeMessageRecord[]>;
  /** Every message (public + internal notes) on the dispute, oldest first —
   *  admin-only. Callers MUST have already verified the caller is an admin
   *  before invoking this. */
  listAll(disputeId: string): Promise<DisputeMessageRecord[]>;
}
