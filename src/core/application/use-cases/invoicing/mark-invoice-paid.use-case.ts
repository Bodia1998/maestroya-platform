import type { InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { InvoicePaid } from "@/domain/events/invoice-paid";

/**
 * Module 79 — Invoicing & Credit Notes: ISSUED -> PAID. Never triggered
 * directly by a user action — the only caller is
 * `MarkInvoicePaidOnPayoutExecutedSubscriber`, reacting to Module 76's
 * own `ProfessionalPayoutExecuted` event once the professional's payout
 * for the Job has actually settled (see that event's own doc comment,
 * which already names this module as the expected subscriber).
 *
 * `executeForJob` (not `execute(invoiceId, ...)`, unlike this module's
 * other lifecycle use cases) because the only thing the caller ever has
 * on hand at payout-execution time is the Job, never the Invoice id
 * directly — see `InvoiceRepository.findByJobId`'s own doc comment on
 * "at most one non-CANCELLED invoice per Job".
 *
 * Deliberately idempotent and silent rather than throwing on every path
 * that a naive `execute(invoiceId, ...)` sibling would reject:
 *  - no invoice at all for the Job (e.g. a Job whose payout flow doesn't
 *    require self-billing) — a no-op, not a `NotFoundError`;
 *  - an invoice already `PAID` (a retried/duplicate delivery of the same
 *    `ProfessionalPayoutExecuted` event, or the subscriber re-running
 *    after a crash) — a no-op, not an `InvalidInvoiceTransitionError`;
 *  - an invoice not yet `ISSUED` (should never happen given
 *    `satisfiesPayoutInvoicePrerequisite`/`CheckInvoiceRequiredForPayoutUseCase`
 *    gate a payout on the invoice already being ISSUED before it can
 *    execute, but defensively treated the same way rather than trusted);
 *  - a lost compare-and-swap race against another concurrent settlement
 *    signal for the same invoice.
 * An event subscriber that throws on an already-applied or inapplicable
 * transition would turn a merely-redundant delivery into a processing
 * failure — this use case's whole job is to make "mark paid" safe to
 * call more than once for the same Job.
 */
export class MarkInvoicePaidUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async executeForJob(jobId: string): Promise<void> {
    const invoice = await this.invoices.findByJobId(jobId);
    if (!invoice) {
      return;
    }
    if (invoice.status !== "ISSUED") {
      // Already PAID (duplicate/retried settlement signal), CANCELLED, or
      // not yet ISSUED — none of these are this use case's job to reject;
      // see this class's own doc comment.
      return;
    }

    const paidAt = new Date();
    const { applied, record } = await this.invoices.markPaid(invoice.id, paidAt, ["ISSUED"]);
    if (!applied) {
      // Lost the compare-and-swap race — another concurrent call already
      // settled (or otherwise transitioned) this invoice; nothing left
      // for this call to do.
      return;
    }

    await publishDomainEvent(
      this.eventBus,
      new InvoicePaid(record.id, record.jobId, record.professionalProfileId, record.companyProfileId, record.totalAmount, record.currency),
      this.failureReporter,
    );
  }
}
