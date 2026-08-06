import { NotFoundError } from "@/domain/errors/domain-error";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import type { SupportTicketRecord, SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 21 — Disputes & Support: assigns/unassigns a SupportTicket to an
 * admin — mirrors AssignDisputeUseCase.
 *
 * Module 37 — Domain Event Subscribers: this use case no longer writes the
 * audit log entry or notifies the assignee itself — both happen because
 * `SupportTicketStatusChanged` is published through the Module 34
 * `EventBus`, reacted to by `RecordSupportTicketAuditLogSubscriber`/
 * `NotifySupportTicketStatusChangeSubscriber`. See
 * `SubmitProfessionalVerificationUseCase`'s own doc comment for the
 * identical publish-and-report-don't-rethrow rationale, mirrored here
 * exactly.
 */
export class AssignSupportTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, ticketId: string, assigneeUserId: string | null): Promise<SupportTicketRecord> {
    const existing = await this.tickets.findById(ticketId);
    if (!existing) {
      throw new NotFoundError("SupportTicket", ticketId);
    }

    const updated = await this.tickets.assign(ticketId, assigneeUserId);

    try {
      await this.eventBus.publishAll([
        new SupportTicketStatusChanged(
          ticketId,
          updated.ticketNumber,
          adminUserId,
          assigneeUserId,
          "ASSIGNED",
          null,
          null,
          existing.assignedAdminUserId,
          assigneeUserId,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
