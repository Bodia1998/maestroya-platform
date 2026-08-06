import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import type { SupportTicketRecord, SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";
import { isClosableStatus } from "@/domain/services/support-ticket-state";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 21 — Disputes & Support: closes a SupportTicket — only reachable
 * from RESOLVED. Admin-only.
 *
 * Module 37 — Domain Event Subscribers: see `AssignSupportTicketUseCase`'s
 * own doc comment — same rationale, same `SupportTicketStatusChanged`
 * publish-and-report-don't-rethrow pattern.
 */
export class CloseSupportTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, ticketId: string): Promise<SupportTicketRecord> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError("SupportTicket", ticketId);
    }

    if (!isClosableStatus(ticket.status)) {
      throw new ValidationError(`Cannot close a ticket in status ${ticket.status}.`);
    }

    const updated = await this.tickets.updateStatus(ticketId, ticket.status, {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: adminUserId,
    });

    try {
      await this.eventBus.publishAll([
        new SupportTicketStatusChanged(
          ticketId,
          updated.ticketNumber,
          adminUserId,
          ticket.openedByUserId,
          "CLOSED",
          ticket.status,
          "CLOSED",
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
