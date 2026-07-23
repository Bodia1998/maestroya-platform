import type { ConversationRepository } from "@/domain/repositories/conversation-repository";

/**
 * Chat module: total unread message count across every conversation the
 * authenticated user belongs to — backs a single nav badge. Inherently
 * scoped to the caller (see ListConversationsUseCase's doc comment on why
 * there's no id-based authorization check needed here).
 */
export class GetUnreadCountUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(userId: string): Promise<number> {
    return this.conversations.countUnreadForUser(userId);
  }
}
