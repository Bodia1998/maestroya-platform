import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateMessageData,
  ListMessagesOptions,
  MessageRecord,
  MessageRepository,
  MessageStatusValue,
} from "@/domain/repositories/message-repository";

const SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  body: true,
  status: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaMessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: PrismaMessageRow): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: row.body,
    status: row.status as MessageStatusValue,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaMessageRepository implements MessageRepository {
  async findById(id: string): Promise<MessageRecord | null> {
    const row = await prisma.message.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async create(data: CreateMessageData): Promise<MessageRecord> {
    // Message insert + Conversation.lastMessageAt bump in one transaction
    // so the two can never disagree — see MessageRepository.create's doc
    // comment.
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: data.conversationId,
          senderId: data.senderId,
          body: data.body,
          status: "SENT",
        },
        select: SELECT,
      }),
      prisma.conversation.update({
        where: { id: data.conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return toRecord(message);
  }

  async listByConversation(conversationId: string, options: ListMessagesOptions): Promise<MessageRecord[]> {
    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        ...(options.before ? { createdAt: { lt: await this.createdAtOf(options.before) } } : {}),
      },
      select: SELECT,
      orderBy: { createdAt: "desc" },
      take: options.limit,
    });
    // Fetched newest-first (so `take` grabs the most recent page even when
    // paginating backwards), then reversed once here into chronological
    // order for direct rendering — see ListMessagesOptions' doc comment.
    return rows.reverse().map(toRecord);
  }

  async softDelete(id: string): Promise<void> {
    await prisma.message.update({
      where: { id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
  }

  private async createdAtOf(messageId: string): Promise<Date> {
    const row = await prisma.message.findUnique({ where: { id: messageId }, select: { createdAt: true } });
    // Falls back to "now" for a cursor that no longer exists (e.g. deleted
    // between requests) rather than throwing — worst case, the page simply
    // starts from the most recent messages instead of erroring the whole
    // list.
    return row?.createdAt ?? new Date();
  }
}
