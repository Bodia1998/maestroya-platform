import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { MessageRecord, MessageRepository } from "@/domain/repositories/message-repository";
import { canSendMessage } from "@/domain/services/conversation-state";

/**
 * Chat module: sends a message into a Conversation the caller belongs to.
 *
 * Authorization: `userId` comes from the server-side session and must be an
 * active (not-left) member of the Conversation — a `conversationId` alone is
 * never enough. A Conversation that exists but the caller isn't part of
 * surfaces as NotFoundError, identical to one that doesn't exist at all, so
 * a member id can never be used to probe for someone else's conversation
 * (IDOR protection, see the module's security notes).
 *
 * Content: `body` is expected to already be trimmed/length-validated by
 * `sendMessageSchema` (see chat.dto.ts) before this use case ever sees it —
 * the same "validate at the DTO boundary" convention every other module's
 * Server Action follows. This use case re-checks non-empty as a defensive
 * second layer, since it may also be called from a future API route that
 * doesn't share the same form validation path.
 *
 * Off-platform-contact scanning, moderation, and delivery/notification
 * hooks are deliberately not implemented here (see the module's Phase 4
 * notes) — this is the single seam a future policy layer would wrap around
 * without touching Conversation/Message persistence.
 */
export class SendMessageUseCase {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
  ) {}

  async execute(userId: string, conversationId: string, body: string): Promise<MessageRecord> {
    const trimmed = body.trim();
    if (!trimmed) {
      throw new ValidationError("Write a message before sending.");
    }

    const conversation = await this.conversations.findById(conversationId);
    const membership = conversation?.members.find((m) => m.userId === userId && !m.leftAt);
    if (!conversation || !membership) {
      throw new NotFoundError("Conversation", conversationId);
    }

    if (!canSendMessage(conversation.status)) {
      throw new ValidationError("This conversation is no longer open for new messages.");
    }

    return this.messages.create({ conversationId, senderId: userId, body: trimmed });
  }
}
