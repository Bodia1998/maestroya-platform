import type {
  ConversationMemberRecord,
  ConversationRecord,
  ConversationRepository,
  ConversationStatusValue,
  ConversationSummary,
} from "@/domain/repositories/conversation-repository";
import type {
  CreateMessageData,
  ListMessagesOptions,
  MessageRecord,
  MessageRepository,
  MessageStatusValue,
} from "@/domain/repositories/message-repository";
import {
  FakeCustomerProfileRepository,
  FakeProfessionalRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
} from "../quotes/fakes";

/**
 * In-memory test doubles for the Chat module, following the same pattern as
 * tests/integration/booking/fakes.ts and tests/integration/quotes/fakes.ts:
 * implement the real interfaces so the use cases under test run their
 * genuine orchestration/authorization logic, with only storage swapped out.
 * Reuses the exact same Fake{CustomerProfile,Professional,Quote,
 * ServiceRequest}Repository the Offers/Quotes module's own tests use.
 */
export { FakeCustomerProfileRepository, FakeProfessionalRepository, FakeQuoteRepository, FakeServiceRequestRepository };

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeConversationRepository implements ConversationRepository {
  conversations = new Map<string, ConversationRecord>();
  /** Optional per-user display info, seeded by tests that exercise the
   *  list/summary UI shape — defaults to null/"Service request" like a real
   *  row with no matching User/ServiceRequest would. */
  userDisplay = new Map<string, { name: string | null; image: string | null }>();
  serviceRequestTitles = new Map<string, string>();

  async findById(id: string) {
    return this.conversations.get(id) ?? null;
  }

  async findByServiceRequestAndParticipants(serviceRequestId: string, userIdA: string, userIdB: string) {
    return (
      [...this.conversations.values()].find(
        (c) =>
          c.serviceRequestId === serviceRequestId &&
          c.members.some((m) => m.userId === userIdA) &&
          c.members.some((m) => m.userId === userIdB),
      ) ?? null
    );
  }

  async create(serviceRequestId: string, memberUserIds: [string, string]): Promise<ConversationRecord> {
    const now = new Date();
    const members: ConversationMemberRecord[] = memberUserIds.map((userId) => ({
      userId,
      joinedAt: now,
      leftAt: null,
      lastReadAt: null,
    }));
    const record: ConversationRecord = {
      id: nextId("fake-conversation"),
      serviceRequestId,
      status: "ACTIVE",
      lastMessageAt: null,
      members,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(record.id, record);
    return record;
  }

  /** Test helper: only messages already created via FakeMessageRepository
   *  populate previews/unread counts in production, but tests exercising
   *  listForUser directly (without going through SendMessageUseCase) can
   *  seed here too. */
  messagesRef: FakeMessageRepository | null = null;

  async listForUser(userId: string): Promise<ConversationSummary[]> {
    const rows = [...this.conversations.values()].filter((c) =>
      c.members.some((m) => m.userId === userId && !m.leftAt),
    );

    return rows
      .map((row) => {
        const member = row.members.find((m) => m.userId === userId);
        const other = row.members.find((m) => m.userId !== userId);
        const messages = this.messagesRef
          ? [...this.messagesRef.messages.values()]
              .filter((m) => m.conversationId === row.id && !m.deletedAt)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          : [];
        const unreadCount = this.messagesRef
          ? [...this.messagesRef.messages.values()].filter(
              (m) =>
                m.conversationId === row.id &&
                m.senderId !== userId &&
                !m.deletedAt &&
                (!member?.lastReadAt || m.createdAt > member.lastReadAt),
            ).length
          : 0;

        const display = other ? this.userDisplay.get(other.userId) : undefined;

        return {
          ...row,
          lastMessagePreview: messages[0]?.body ?? null,
          unreadCount,
          serviceRequestTitle: this.serviceRequestTitles.get(row.serviceRequestId) ?? "Service request",
          otherParticipant: {
            userId: other?.userId ?? "",
            name: display?.name ?? null,
            image: display?.image ?? null,
          },
        };
      })
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  }

  async markRead(conversationId: string, userId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    const updated: ConversationRecord = {
      ...conversation,
      members: conversation.members.map((m) => (m.userId === userId ? { ...m, lastReadAt: new Date() } : m)),
    };
    this.conversations.set(conversationId, updated);
  }

  async countUnreadForUser(userId: string): Promise<number> {
    const summaries = await this.listForUser(userId);
    return summaries.reduce((sum, s) => sum + s.unreadCount, 0);
  }

  bumpLastMessageAt(conversationId: string, at: Date) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    this.conversations.set(conversationId, { ...conversation, lastMessageAt: at, updatedAt: at });
  }
}

export class FakeMessageRepository implements MessageRepository {
  messages = new Map<string, MessageRecord>();

  constructor(private readonly conversations: FakeConversationRepository) {
    conversations.messagesRef = this;
  }

  async findById(id: string) {
    return this.messages.get(id) ?? null;
  }

  async create(data: CreateMessageData): Promise<MessageRecord> {
    const now = new Date();
    const record: MessageRecord = {
      id: nextId("fake-message"),
      conversationId: data.conversationId,
      senderId: data.senderId,
      body: data.body,
      status: "SENT",
      type: data.type ?? "USER",
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.messages.set(record.id, record);
    this.conversations.bumpLastMessageAt(data.conversationId, now);
    return record;
  }

  async listByConversation(conversationId: string, options: ListMessagesOptions): Promise<MessageRecord[]> {
    const all = [...this.messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const upperBoundIndex = options.before
      ? all.findIndex((m) => m.id === options.before)
      : all.length;
    const slice = all.slice(0, upperBoundIndex === -1 ? all.length : upperBoundIndex);
    return slice.slice(Math.max(0, slice.length - options.limit));
  }

  async softDelete(id: string): Promise<void> {
    const existing = this.messages.get(id);
    if (!existing) return;
    this.messages.set(id, {
      ...existing,
      status: "DELETED" as MessageStatusValue,
      deletedAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

export type { ConversationStatusValue };
