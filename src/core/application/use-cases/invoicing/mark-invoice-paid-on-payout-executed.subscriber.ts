import type { EventHandler } from "@/application/ports/event-bus";
import type { ProfessionalPayoutExecuted } from "@/domain/events/professional-payout-executed";
import type { MarkInvoicePaidUseCase } from "./mark-invoice-paid.use-case";

/**
 * Module 79 — Invoicing & Credit Notes: subscribes to Module 76's own
 * `ProfessionalPayoutExecuted` — the exact signal that event's own doc
 * comment already names Module 79 as an expected subscriber of — and
 * marks the Job's invoice PAID. Never re-executes or inspects the payout
 * itself; by the time this handler runs, Module 76 has already durably
 * recorded the transfer as successful.
 */
export class MarkInvoicePaidOnPayoutExecutedSubscriber implements EventHandler<ProfessionalPayoutExecuted> {
  constructor(private readonly markInvoicePaid: MarkInvoicePaidUseCase) {}

  async handle(event: ProfessionalPayoutExecuted): Promise<void> {
    await this.markInvoicePaid.executeForJob(event.jobId);
  }
}
