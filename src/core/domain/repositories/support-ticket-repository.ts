/**
 * Module 21 — Disputes & Support: repository interface for the
 * SupportTicket aggregate — general (non-order-tied) support issues,
 * sharing the Dispute module's lifecycle-shape/admin-workflow conventions
 * but not its table (see schema.prisma's SupportTicketCategory doc
 * comment).
 */

export type SupportTicketCategoryValue = "ACCOUNT" | "VERIFICATION" | "BUG" | "LOGIN" | "GENERAL" | "OTHER";

export type SupportTicketStatusValue = "OPEN" | "IN_PROGRESS" | "WAITING_FOR_USER" | "RESOLVED" | "CLOSED";

export type SupportTicketPriorityValue = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface SupportTicketRecord {
  id: string;
  ticketNumber: string;
  category: SupportTicketCategoryValue;
  subject: string;
  description: string;
  status: SupportTicketStatusValue;
  priority: SupportTicketPriorityValue;
  openedByUserId: string;
  assignedAdminUserId: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  closedAt: Date | null;
  closedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSupportTicketData {
  ticketNumber: string;
  category: SupportTicketCategoryValue;
  subject: string;
  description: string;
  priority: SupportTicketPriorityValue;
  openedByUserId: string;
}

export interface ListSupportTicketsOptions {
  limit: number;
  offset: number;
  status?: SupportTicketStatusValue;
}

export interface ListAdminSupportTicketsOptions {
  limit: number;
  offset: number;
  status?: SupportTicketStatusValue;
  priority?: SupportTicketPriorityValue;
  category?: SupportTicketCategoryValue;
  assignedAdminUserId?: string;
  search?: string;
}

export interface SupportTicketRepository {
  findById(id: string): Promise<SupportTicketRecord | null>;
  listOpenedByUser(userId: string, options: ListSupportTicketsOptions): Promise<SupportTicketRecord[]>;
  listForAdmin(options: ListAdminSupportTicketsOptions): Promise<SupportTicketRecord[]>;

  /** Total ticket count across all users — the sequence source for
   *  ticketNumber generation (see CreateSupportTicketUseCase). Must be a
   *  platform-wide count, NOT scoped to a single user: ticketNumber is
   *  globally unique, so counting only the caller's own tickets would hand
   *  out the same sequence number (and therefore the same ticketNumber) to
   *  two different users' first ticket. */
  countAll(): Promise<number>;

  /** Implementations MUST translate a DB unique constraint violation on
   *  `ticketNumber` into a `ConflictError` — see
   *  PrismaSupportTicketRepository.create's doc comment. */
  create(data: CreateSupportTicketData): Promise<SupportTicketRecord>;

  updateStatus(
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
  ): Promise<SupportTicketRecord>;

  assign(id: string, assignedAdminUserId: string | null): Promise<SupportTicketRecord>;
}
