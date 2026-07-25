import { NotFoundError } from "@/domain/errors/domain-error";
import type { SupportTicketRecord, SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";

/**
 * Module 21 — Disputes & Support: fetches a SupportTicket for its opener.
 * Simple ownership check (`openedByUserId === userId`) — no cross-
 * aggregate ownership resolution needed the way Dispute has (a ticket has
 * no Job/counterparty). IDOR-safe: an unrelated user gets the same
 * NotFoundError a nonexistent ticket id would produce. Admin access goes
 * through the separate GetAdminSupportTicketUseCase (trusts requireRole),
 * mirroring Dispute's split.
 */
export class GetSupportTicketByIdUseCase {
  constructor(private readonly tickets: SupportTicketRepository) {}

  async execute(userId: string, ticketId: string): Promise<SupportTicketRecord> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket || ticket.openedByUserId !== userId) {
      throw new NotFoundError("SupportTicket", ticketId);
    }
    return ticket;
  }
}
