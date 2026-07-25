import type {
  ListAdminSupportTicketsOptions,
  SupportTicketRecord,
  SupportTicketRepository,
} from "@/domain/repositories/support-ticket-repository";

/** Module 21 — Disputes & Support: admin oversight listing for
 *  SupportTicket — mirrors ListAdminDisputesUseCase. */
export class ListAdminSupportTicketsUseCase {
  constructor(private readonly tickets: SupportTicketRepository) {}

  async execute(options: ListAdminSupportTicketsOptions): Promise<SupportTicketRecord[]> {
    return this.tickets.listForAdmin(options);
  }
}
