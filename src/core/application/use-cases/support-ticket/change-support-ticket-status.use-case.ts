import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import type {
  SupportTicketRecord,
  SupportTicketRepository,
  SupportTicketStatusValue,
} from "@/domain/repositories/support-ticket-repository";
import { canTransitionSupportTicketStatus } from "@/domain/services/support-ticket-state";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 21 — Disputes & Support: admin-only generic status transition for
 * SupportTicket — covers OPEN -> IN_PROGRESS and IN_PROGRESS <->
 * WAITING_FOR_USER. RESOLVED/CLOSED each have their own dedicated use case
 * (ResolveSupportTicketUseCase/CloseSupportTicketUseCase), mirroring
 * ChangeDisputeStatusUseCase's own split and its reasoning.
 *
 * Module 37 — Domain Event Subscribers: see `AssignSupportTicketUseCase`'s
 * own doc comment — same rationale, same `SupportTicketStatusChanged`
 * publish-and-report-don't-rethrow pattern.
 */
export class ChangeSupportTicketStatusUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, ticketId: string, nextStatus: SupportTicketStatusValue): Promise<SupportTicketRecord> {
    if (nextStatus === "RESOLVED" || nextStatus === "CLOSED") {
      throw new ValidationError("Use the resolve/close action for this transition — it requires a resolution note.");
    }

    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError("SupportTicket", ticketId);
    }

    if (!canTransitionSupportTicketStatus(ticket.status, nextStatus)) {
      throw new ValidationError(`Cannot move a ticket from ${ticket.status} to ${nextStatus}.`);
    }

    const updated = await this.tickets.updateStatus(ticketId, ticket.status, { status: nextStatus });

    try {
      await this.eventBus.publishAll([
        new SupportTicketStatusChanged(
          ticketId,
          updated.ticketNumber,
          adminUserId,
          ticket.openedByUserId,
          "STATUS_CHANGED",
          ticket.status,
          nextStatus,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
