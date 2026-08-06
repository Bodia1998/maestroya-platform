import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import type {
  CreateSupportTicketData,
  ListAdminSupportTicketsOptions,
  ListSupportTicketsOptions,
  SupportTicketCategoryValue,
  SupportTicketPriorityValue,
  SupportTicketRecord,
  SupportTicketRepository,
  SupportTicketStatusValue,
} from "@/domain/repositories/support-ticket-repository";

const SELECT = {
  id: true,
  ticketNumber: true,
  category: true,
  subject: true,
  description: true,
  status: true,
  priority: true,
  openedByUserId: true,
  assignedAdminUserId: true,
  resolutionNote: true,
  resolvedAt: true,
  resolvedByUserId: true,
  closedAt: true,
  closedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  ticketNumber: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  openedByUserId: string;
  assignedAdminUserId: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  closedAt: Date | null;
  closedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): SupportTicketRecord {
  return {
    ...row,
    category: row.category as SupportTicketCategoryValue,
    status: row.status as SupportTicketStatusValue,
    priority: row.priority as SupportTicketPriorityValue,
  };
}

/** Module 21 — Disputes & Support: Prisma implementation of
 *  SupportTicketRepository. Mirrors PrismaDisputeRepository's shape. */
export class PrismaSupportTicketRepository implements SupportTicketRepository {
  async findById(id: string): Promise<SupportTicketRecord | null> {
    const row = await prisma.supportTicket.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async listOpenedByUser(userId: string, options: ListSupportTicketsOptions): Promise<SupportTicketRecord[]> {
    const rows = await prisma.supportTicket.findMany({
      where: { openedByUserId: userId, ...(options.status ? { status: options.status } : {}) },
      select: SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  /** Platform-wide count — see the interface doc comment on why this must
   *  not be scoped to a single user. */
  async countAll(): Promise<number> {
    return prisma.supportTicket.count();
  }

  async listForAdmin(options: ListAdminSupportTicketsOptions): Promise<SupportTicketRecord[]> {
    const rows = await prisma.supportTicket.findMany({
      where: {
        ...(options.status ? { status: options.status } : {}),
        ...(options.priority ? { priority: options.priority } : {}),
        ...(options.category ? { category: options.category } : {}),
        ...(options.assignedAdminUserId ? { assignedAdminUserId: options.assignedAdminUserId } : {}),
        ...(options.search
          ? {
              OR: [
                { ticketNumber: { contains: options.search, mode: "insensitive" } },
                { subject: { contains: options.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  /** `ticketNumber` is unique at the DB level — same race-window caveat and
   *  P2002-to-ConflictError translation as PrismaDisputeRepository.create. */
  async create(data: CreateSupportTicketData): Promise<SupportTicketRecord> {
    try {
      const row = await prisma.supportTicket.create({
        data: {
          ticketNumber: data.ticketNumber,
          category: data.category,
          subject: data.subject,
          description: data.description,
          priority: data.priority,
          openedByUserId: data.openedByUserId,
        },
        select: SELECT,
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Ticket number collided — please retry.");
      }
      throw error;
    }
  }

  async updateStatus(
    id: string,
    expectedStatus: SupportTicketStatusValue,
    data: {
      status: SupportTicketStatusValue;
      resolutionNote?: string | null;
      resolvedAt?: Date | null;
      resolvedByUserId?: string | null;
      closedAt?: Date | null;
      closedByUserId?: string | null;
    },
  ): Promise<SupportTicketRecord> {
    const result = await prisma.supportTicket.updateMany({
      where: { id, status: expectedStatus },
      data: {
        status: data.status,
        resolutionNote: data.resolutionNote,
        resolvedAt: data.resolvedAt,
        resolvedByUserId: data.resolvedByUserId,
        closedAt: data.closedAt,
        closedByUserId: data.closedByUserId,
      },
    });
    if (result.count === 0) {
      throw new ConflictError("This ticket's status changed before this update could be applied.");
    }
    const row = await prisma.supportTicket.findUniqueOrThrow({ where: { id }, select: SELECT });
    return toRecord(row);
  }

  async assign(id: string, assignedAdminUserId: string | null): Promise<SupportTicketRecord> {
    const row = await prisma.supportTicket.update({
      where: { id },
      data: { assignedAdminUserId },
      select: SELECT,
    });
    return toRecord(row);
  }
}
