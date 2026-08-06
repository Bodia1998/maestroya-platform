import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import type { SupportTicketRecord, SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";
import { isResolvableStatus } from "@/domain/services/support-ticket-state";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 21 — Disputes & Support: resolves a SupportTicket. Admin-only.
 *
 * Module 37 — Domain Event Subscribers: see `AssignSupportTicketUseCase`'s
 * own doc comment — same rationale, same `SupportTicketStatusChanged`
 * publish-and-report-don't-rethrow pattern.
 */
export class ResolveSupportTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, ticketId: string, resolutionNote: string): Promise<SupportTicketRecord> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError("SupportTicket", ticketId);
    }

    if (!isResolvableStatus(ticket.status)) {
      throw new ValidationError(`Cannot resolve a ticket in status ${ticket.status}.`);
    }

    const updated = await this.tickets.updateStatus(ticketId, ticket.status, {
      status: "RESOLVED",
      resolutionNote,
      resolvedAt: new Date(),
      resolvedByUserId: adminUserId,
    });

    try {
      await this.eventBus.publishAll([
        new SupportTicketStatusChanged(
          ticketId,
          updated.ticketNumber,
          adminUserId,
          ticket.openedByUserId,
          "RESOLVED",
          ticket.status,
          "RESOLVED",
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
