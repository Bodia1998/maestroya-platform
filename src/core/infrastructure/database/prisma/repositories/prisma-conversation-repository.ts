import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  ConversationMemberRecord,
  ConversationRecord,
  ConversationRepository,
  ConversationStatusValue,
  ConversationSummary,
} from "@/domain/repositories/conversation-repository";

const MEMBER_SELECT = {
  userId: true,
  joinedAt: true,
  leftAt: true,
  lastReadAt: true,
} as const;

const SELECT = {
  id: true,
  serviceRequestId: true,
  status: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
  members: { select: MEMBER_SELECT },
} as const;

type PrismaConversationRow = {
  id: string;
  serviceRequestId: string | null;
  status: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  members: ConversationMemberRecord[];
};

function toRecord(row: PrismaConversationRow): ConversationRecord {
  return {
    id: row.id,
    // The Chat module only ever creates conversations tied to a
    // ServiceRequest (see conversation-repository.ts's scope note) — this
    // is always non-null for rows this module writes.
    serviceRequestId: row.serviceRequestId as string,
    status: row.status as ConversationStatusValue,
    lastMessageAt: row.lastMessageAt,
    members: row.members,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaConversationRepository implements ConversationRepository {
  async findById(id: string): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByServiceRequestAndParticipants(
    serviceRequestId: string,
    userIdA: string,
    userIdB: string,
  ): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findFirst({
      where: {
        serviceRequestId,
        AND: [
          { members: { some: { userId: userIdA } } },
          { members: { some: { userId: userIdB } } },
        ],
      },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async create(serviceRequestId: string, memberUserIds: [string, string]): Promise<ConversationRecord> {
    // Guards against a duplicate thread from a race between two concurrent
    // "open conversation" calls for the same pair (e.g. a double-click) —
    // re-checks for an existing conversation *inside* the transaction
    // before creating one, same defensive-transaction style as
    // PrismaQuoteAcceptanceRepository.
    return prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: {
          serviceRequestId,
          AND: [
            { members: { some: { userId: memberUserIds[0] } } },
            { members: { some: { userId: memberUserIds[1] } } },
          ],
        },
        select: SELECT,
      });
      if (existing) {
        return toRecord(existing);
      }

      const created = await tx.conversation.create({
        data: {
          serviceRequestId,
          status: "ACTIVE",
          members: {
            create: memberUserIds.map((userId) => ({ userId })),
          },
        },
        select: SELECT,
      });
      return toRecord(created);
    });
  }

  async listForUser(userId: string): Promise<ConversationSummary[]> {
    const rows = await prisma.conversation.findMany({
      where: { members: { some: { userId, leftAt: null } } },
      select: {
        ...SELECT,
        serviceRequest: { select: { title: true } },
        members: {
          select: {
            ...MEMBER_SELECT,
            user: { select: { name: true, image: true } },
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true },
        },
      },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    });
    if (rows.length === 0) return [];

    // Single query for every unread message across every one of this
    // user's conversations, rather than one COUNT per conversation
    // (avoids the N+1 this would otherwise be) — grouped/filtered in
    // memory below since each conversation's "unread" threshold is that
    // member's own `lastReadAt`, which differs per row and so can't be
    // expressed as one shared WHERE clause.
    const unreadMessages = await prisma.message.findMany({
      where: {
        conversationId: { in: rows.map((r) => r.id) },
        senderId: { not: userId },
        deletedAt: null,
      },
      select: { conversationId: true, createdAt: true },
    });

    return rows.map((row) => {
      const member = row.members.find((m) => m.userId === userId);
      const threshold = member?.lastReadAt ?? null;
      const unreadCount = unreadMessages.filter(
        (m) => m.conversationId === row.id && (!threshold || m.createdAt > threshold),
      ).length;
      const other = row.members.find((m) => m.userId !== userId);

      return {
        ...toRecord(row),
        lastMessagePreview: row.messages[0]?.body ?? null,
        unreadCount,
        serviceRequestTitle: row.serviceRequest?.title ?? "Service request",
        otherParticipant: {
          userId: other?.userId ?? "",
          name: other?.user.name ?? null,
          image: other?.user.image ?? null,
        },
      };
    });
  }

  async markRead(conversationId: string, userId: string): Promise<void> {
    await prisma.conversationMember.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
  }

  async countUnreadForUser(userId: string): Promise<number> {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId, leftAt: null },
      select: { conversationId: true, lastReadAt: true },
    });
    if (memberships.length === 0) return 0;

    // Same single-query-then-filter approach as listForUser, for the same
    // N+1-avoidance reason.
    const unreadMessages = await prisma.message.findMany({
      where: {
        conversationId: { in: memberships.map((m) => m.conversationId) },
        senderId: { not: userId },
        deletedAt: null,
      },
      select: { conversationId: true, createdAt: true },
    });

    const thresholdByConversation = new Map(memberships.map((m) => [m.conversationId, m.lastReadAt]));
    return unreadMessages.filter((m) => {
      const threshold = thresholdByConversation.get(m.conversationId) ?? null;
      return !threshold || m.createdAt > threshold;
    }).length;
  }
}
