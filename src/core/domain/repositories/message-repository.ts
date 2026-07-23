/**
 * Chat module: repository interface for the existing `Message` model (see
 * schema.prisma's "Messaging" section). Follows the same "narrow,
 * module-scoped interface" convention as ConversationRepository.
 *
 * `MessageAttachment` exists on the schema for a future attachments feature
 * this module does not implement — every record here always has an empty
 * attachment list.
 */

export type MessageStatusValue = "SENT" | "DELIVERED" | "READ" | "DELETED";

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  status: MessageStatusValue;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMessageData {
  conversationId: string;
  senderId: string;
  body: string;
}

export interface ListMessagesOptions {
  /** Cursor pagination: returns messages strictly older than this message
   *  id, newest-first internally, but ListMessagesUseCase returns them in
   *  chronological order for display. Omit for the most recent page. */
  before?: string;
  limit: number;
}

export interface MessageRepository {
  findById(id: string): Promise<MessageRecord | null>;
  /**
   * Creates the message and, in the same transaction, bumps the parent
   * Conversation's `lastMessageAt` — the two must never disagree (a
   * conversation's "last activity" timestamp must always match its most
   * recent message), so this is one atomic operation rather than two
   * separate repository calls a use case could partially fail between.
   */
  create(data: CreateMessageData): Promise<MessageRecord>;
  /** Chronologically ordered (oldest of the page first) for direct
   *  rendering — see ListMessagesOptions for pagination. */
  listByConversation(conversationId: string, options: ListMessagesOptions): Promise<MessageRecord[]>;
  /** Soft-deletes the message (status DELETED, deletedAt set) — the row and
   *  its history are kept, never hard-deleted, matching the schema's
   *  Message.deletedAt doc comment and the platform's audit/dispute needs. */
  softDelete(id: string): Promise<void>;
}
