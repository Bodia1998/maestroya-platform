import { NotFoundError } from "@/domain/errors/domain-error";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";

/**
 * Chat module: marks a Conversation as read (up to "now") for the
 * authenticated member — backs the unread-count/unread-indicator UI.
 * Idempotent: calling it again with nothing new to read is a harmless
 * no-op.
 *
 * Authorization: same membership check as every other conversationId-scoped
 * use case — a non-member gets NotFoundError, never a silent no-op that
 * would leak whether the id exists.
 */
export class MarkConversationReadUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.conversations.findById(conversationId);
    const isMember = conversation?.members.some((m) => m.userId === userId);
    if (!conversation || !isMember) {
      throw new NotFoundError("Conversation", conversationId);
    }

    await this.conversations.markRead(conversationId, userId);
  }
}
