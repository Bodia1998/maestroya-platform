import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type {
  SupportTicketCategoryValue,
  SupportTicketRecord,
  SupportTicketRepository,
} from "@/domain/repositories/support-ticket-repository";
import { formatCaseNumber } from "@/domain/services/dispute-rules";

export interface CreateSupportTicketInput {
  category: SupportTicketCategoryValue;
  subject: string;
  description: string;
}

/**
 * Module 21 — Disputes & Support: opens a general (non-order-tied) support
 * ticket. Any authenticated user may open one — there is no Job/ownership
 * check the way CreateDisputeUseCase has, since a support ticket is by
 * definition not anchored to an order.
 *
 * Ticket numbering uses the same best-effort count-based scheme as Dispute
 * case numbers — see dispute-rules.ts's formatCaseNumber doc comment for
 * the known race-window limitation. Unlike Dispute (whose caseNumber
 * sequence is scoped per-Job, where each Job's own dispute list is a
 * natural, disjoint counting scope), SupportTicket.ticketNumber is unique
 * platform-wide with no such natural per-scope grouping — so the sequence
 * must come from `countAll()` (a global count), never from a per-user
 * count. Counting only the caller's own tickets would hand two different
 * users' first-ever ticket the same sequence number, and therefore the
 * same ticketNumber, which collides against the global uniqueness
 * constraint (both in the DB and in the fake repository used by tests).
 */
export class CreateSupportTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(userId: string, input: CreateSupportTicketInput): Promise<SupportTicketRecord> {
    const totalTicketCount = await this.tickets.countAll();
    const ticketNumber = formatCaseNumber("TCK", new Date().getFullYear(), totalTicketCount + 1);

    const ticket = await this.tickets.create({
      ticketNumber,
      category: input.category,
      subject: input.subject,
      description: input.description,
      priority: "MEDIUM",
      openedByUserId: userId,
    });

    try {
      await this.auditLog.record({
        adminUserId: userId,
        action: "SUPPORT_TICKET_CREATED",
        targetType: "SupportTicket",
        targetId: ticket.id,
        metadata: { ticketNumber: ticket.ticketNumber, category: ticket.category },
      });
    } catch (error) {
      console.error("Failed to record support-ticket-created audit log", error);
    }

    // No notification on creation — there is no fixed "assignee" yet (an
    // admin picks it up from the queue); DISPUTE_CREATED's respondent-
    // notification equivalent doesn't apply here since a general ticket has
    // no counterparty. Assignment is what first notifies a human (the
    // assigned admin) — see AssignSupportTicketUseCase.
    return ticket;
  }
}
