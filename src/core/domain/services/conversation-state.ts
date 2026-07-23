import type { ConversationStatusValue } from "@/domain/repositories/conversation-repository";

/**
 * Chat module — Conversation state rules, kept as a small dependency-free
 * domain helper (same style as quote-state.ts/service-request-state.ts)
 * rather than inlined checks scattered across use cases.
 *
 * Business rule (Phase 3 of the module spec): once a customer/professional
 * relationship is established on a ServiceRequest (the professional has
 * submitted at least one Quote — see OpenConversationUseCase), the resulting
 * Conversation stays ACTIVE and readable indefinitely, including after the
 * ServiceRequest is completed, cancelled, or the Quote is withdrawn/rejected
 * — "can users access old conversations" is answered yes, unconditionally,
 * for anyone who was a member. Sending new messages, however, is only
 * allowed while the Conversation itself is ACTIVE.
 *
 * This module never transitions a Conversation to ARCHIVED or CLOSED — every
 * Conversation is created and stays ACTIVE for the lifetime of this module's
 * scope. Those two statuses exist on the schema for a future
 * moderation/support or "close conversation" workflow (e.g. an admin closing
 * a conversation under dispute) to use without a schema change.
 */
export function canSendMessage(status: ConversationStatusValue): boolean {
  return status === "ACTIVE";
}
