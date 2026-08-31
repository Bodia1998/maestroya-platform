import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { MessageRecord, MessageRepository } from "@/domain/repositories/message-repository";
import type { TrustAutomatedActionRepository } from "@/domain/repositories/trust-automated-action-repository";
import { canSendMessage } from "@/domain/services/conversation-state";
import type { DetectOffPlatformCommunicationUseCase } from "@/application/use-cases/trust-integrity/detect-off-platform-communication.use-case";

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
 * Module 89 — Fraud & Trust Signal Activation: this is that single seam.
 * Before persisting, an ACTIVE MESSAGING_RESTRICTION TrustAutomatedAction
 * (Module 65) on the sender blocks the send outright — re-checked fresh
 * here, never cached. After persisting, the message body is handed
 * best-effort to DetectOffPlatformCommunicationUseCase (Module 65's own
 * off-platform rule engine) exactly the way the notification hook below
 * already treats delivery as best-effort: a detection failure is logged
 * and never undoes or fails the send. Both dependencies are optional and
 * default to skipping (identical to `notifications` above), so every
 * pre-existing direct construction of this use case (this codebase's own
 * tests) keeps compiling and behaving exactly as before; production's own
 * compose root always supplies both.
 */
export class SendMessageUseCase {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    // Notifications module (Module 15): optional, defaults to a no-op —
    // see NullNotificationCreator's own doc comment.
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
    // Module 89 — Fraud & Trust Signal Activation: both optional, see this
    // class's own doc comment above.
    private readonly trustAutomatedActions?: TrustAutomatedActionRepository,
    private readonly offPlatformDetection?: Pick<DetectOffPlatformCommunicationUseCase, "execute">,
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

    // Module 89 — Fraud & Trust Signal Activation: see this class's own
    // doc comment. Re-checked fresh, immediately before the write.
    if (this.trustAutomatedActions) {
      const activeRestrictions = await this.trustAutomatedActions.listActiveForUser(userId, "MESSAGING_RESTRICTION");
      if (activeRestrictions.length > 0) {
        throw new ValidationError("An active messaging restriction on your account blocks sending messages right now.");
      }
    }

    const message = await this.messages.create({ conversationId, senderId: userId, body: trimmed });

    // Best-effort — see this class's own doc comment. A detection failure
    // must never undo or fail message delivery itself.
    if (this.offPlatformDetection) {
      try {
        await this.offPlatformDetection.execute({
          userId,
          text: trimmed,
          sourceType: "MESSAGE",
          sourceId: message.id,
        });
      } catch (error) {
        console.error("Failed to run off-platform detection on chat message", error);
      }
    }

    // Best-effort — mirrors ChatAppointmentNotifier/ChatJobNotifier's own
    // doc comment: a notification-creation failure must never undo or
    // fail message delivery itself. Every other *active* member besides
    // the sender is notified — never the sender themselves.
    try {
      const recipients = conversation.members.filter((m) => m.userId !== userId && !m.leftAt);
      for (const recipient of recipients) {
        await this.notifications.notify({
          userId: recipient.userId,
          type: "NEW_MESSAGE",
          title: "New message",
          message: trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed,
          resourceType: "CONVERSATION",
          resourceId: conversationId,
          actionUrl: `/messages/${conversationId}`,
        });
      }
    } catch (error) {
      console.error("Failed to create new-message notification", error);
    }

    return message;
  }
}
