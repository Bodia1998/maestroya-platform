import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { MessageRepository } from "@/domain/repositories/message-repository";

/**
 * Chat module: lets a user "unsend" (soft-delete) their own message.
 *
 * Business rule (Phase 3): a user can delete their own messages, never
 * someone else's — attempting to delete another member's message throws
 * UnauthorizedError. There is no conversation-deletion use case in this
 * module's scope (see conversation-repository.ts's doc comment) — only
 * individual messages can be removed, and only by their own sender.
 *
 * The message id alone is enough to authorize this — no separate
 * conversationId/membership check is needed, since ownership of the message
 * itself (`senderId === userId`) already implies the caller was a member of
 * its conversation when they sent it.
 */
export class DeleteMessageUseCase {
  constructor(private readonly messages: MessageRepository) {}

  async execute(userId: string, messageId: string): Promise<void> {
    const message = await this.messages.findById(messageId);
    if (!message) {
      throw new NotFoundError("Message", messageId);
    }
    if (message.senderId !== userId) {
      throw new UnauthorizedError("You can only delete your own messages.");
    }
    if (message.status === "DELETED") {
      return;
    }

    await this.messages.softDelete(messageId);
  }
}
