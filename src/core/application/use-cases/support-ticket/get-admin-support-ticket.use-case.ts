import { NotFoundError } from "@/domain/errors/domain-error";
import type { SupportTicketRecord, SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";

/** Module 21 — Disputes & Support: admin detail view for a SupportTicket.
 *  Trusts `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action
 *  boundary. */
export class GetAdminSupportTicketUseCase {
  constructor(private readonly tickets: SupportTicketRepository) {}

  async execute(ticketId: string): Promise<SupportTicketRecord> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError("SupportTicket", ticketId);
    }
    return ticket;
  }
}
