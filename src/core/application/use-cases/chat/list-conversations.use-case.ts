import type { ConversationRepository, ConversationSummary } from "@/domain/repositories/conversation-repository";

/**
 * Chat module: lists every Conversation the authenticated user currently
 * belongs to, newest activity first — the data behind the conversation
 * list / inbox view. `userId` always comes from the server-side session;
 * there is no parameter to list another user's conversations, so there is
 * no authorization check to bypass here by construction (unlike
 * id-addressed use cases, this one is inherently scoped to the caller).
 */
export class ListConversationsUseCase {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(userId: string): Promise<ConversationSummary[]> {
    return this.conversations.listForUser(userId);
  }
}
