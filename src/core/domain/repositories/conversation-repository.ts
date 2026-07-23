/**
 * Chat module: repository interface for the existing `Conversation` /
 * `ConversationMember` models (see schema.prisma's "Messaging" section).
 * Follows the same "narrow, module-scoped interface" convention as
 * QuoteRepository/ServiceRequestRepository — only the operations this
 * module's use cases need.
 *
 * Scope note: a Conversation is always scoped to exactly one ServiceRequest
 * and exactly two members — the ServiceRequest's customer and one
 * professional who has submitted a Quote on it (see OpenConversationUseCase
 * for the full eligibility rule). `serviceRequestId` is nullable on the
 * schema to also allow a future platform/support conversation not tied to a
 * request, but this module never creates one of those — every method here
 * that creates a Conversation requires a serviceRequestId.
 *
 * `MessageAttachment` and company-member participants exist on the schema
 * for future modules (attachments, company accounts) and are intentionally
 * not touched by this module's interface.
 */

export type ConversationStatusValue = "ACTIVE" | "ARCHIVED" | "CLOSED";

export interface ConversationMemberRecord {
  userId: string;
  joinedAt: Date;
  leftAt: Date | null;
  lastReadAt: Date | null;
}

export interface ConversationRecord {
  id: string;
  serviceRequestId: string;
  status: ConversationStatusValue;
  lastMessageAt: Date | null;
  members: ConversationMemberRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationSummary extends ConversationRecord {
  /** Preview of the most recent message, or null if nothing was ever sent. */
  lastMessagePreview: string | null;
  /** Count of messages in this conversation the caller hasn't read yet. */
  unreadCount: number;
  /** Title of the ServiceRequest this conversation is about — denormalized
   *  read for the conversation-list UI so it doesn't need a second lookup
   *  per row. */
  serviceRequestTitle: string;
  /** The other member of this two-person conversation, relative to
   *  whichever userId `listForUser` was called with. Never includes the
   *  caller themself. */
  otherParticipant: { userId: string; name: string | null; image: string | null };
}

export interface ConversationRepository {
  findById(id: string): Promise<ConversationRecord | null>;
  /**
   * Looks up the (at most one) Conversation for a given ServiceRequest
   * between two specific users, regardless of which order they're passed —
   * this is the lookup OpenConversationUseCase uses to implement
   * "find-or-create" idempotently, so re-opening the same
   * customer/professional pair on the same request never creates a
   * duplicate thread.
   */
  findByServiceRequestAndParticipants(
    serviceRequestId: string,
    userIdA: string,
    userIdB: string,
  ): Promise<ConversationRecord | null>;
  /**
   * Creates a new Conversation with exactly the two given members, atomic
   * with the membership rows so a Conversation can never briefly exist with
   * zero/one members.
   */
  create(serviceRequestId: string, memberUserIds: [string, string]): Promise<ConversationRecord>;
  /**
   * All conversations a user currently belongs to (i.e. hasn't left),
   * newest activity first, with a last-message preview and this user's own
   * unread count — the exact shape ListConversationsUseCase needs without
   * requiring a second round trip per conversation.
   */
  listForUser(userId: string): Promise<ConversationSummary[]>;
  /** Marks everything up to now as read for this member. Idempotent. */
  markRead(conversationId: string, userId: string): Promise<void>;
  /** Total unread message count across every conversation this user is in
   *  — backs a single nav badge rather than the per-conversation list. */
  countUnreadForUser(userId: string): Promise<number>;
}
