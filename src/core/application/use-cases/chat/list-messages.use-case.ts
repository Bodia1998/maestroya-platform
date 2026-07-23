import { NotFoundError } from "@/domain/errors/domain-error";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { MessageRecord, MessageRepository } from "@/domain/repositories/message-repository";

export const MESSAGES_PAGE_SIZE = 50;

/**
 * Chat module: lists messages for a Conversation the caller belongs to,
 * oldest-first within the returned page — see MessageRepository's doc
 * comment for the pagination contract.
 *
 * Authorization is the same membership check as SendMessageUseCase — a
 * Conversation the caller isn't (or is no longer) a member of surfaces as
 * NotFoundError. Unlike sending, *reading* is allowed regardless of
 * Conversation.status (ACTIVE/ARCHIVED/CLOSED) and regardless of the
 * underlying ServiceRequest's own status — "can users access old
 * conversations" is answered yes for any past member (see
 * conversation-state.ts).
 *
 * Soft-deleted messages (status DELETED) are still returned — the UI is
 * expected to render them as a "message deleted" placeholder rather than
 * the original body, exactly like most chat products, rather than silently
 * closing a gap in the conversation's ordering.
 */
export class ListMessagesUseCase {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
  ) {}

  async execute(userId: string, conversationId: string, before?: string): Promise<MessageRecord[]> {
    const conversation = await this.conversations.findById(conversationId);
    const isMember = conversation?.members.some((m) => m.userId === userId);
    if (!conversation || !isMember) {
      throw new NotFoundError("Conversation", conversationId);
    }

    return this.messages.listByConversation(conversationId, { before, limit: MESSAGES_PAGE_SIZE });
  }
}
