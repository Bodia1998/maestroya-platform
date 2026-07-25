import type {
  SupportTicketRecord,
  SupportTicketRepository,
  SupportTicketStatusValue,
} from "@/domain/repositories/support-ticket-repository";

export interface ListMySupportTicketsInput {
  status?: SupportTicketStatusValue;
  limit: number;
  offset: number;
}

export class ListMySupportTicketsUseCase {
  constructor(private readonly tickets: SupportTicketRepository) {}

  async execute(userId: string, input: ListMySupportTicketsInput): Promise<SupportTicketRecord[]> {
    return this.tickets.listOpenedByUser(userId, input);
  }
}
