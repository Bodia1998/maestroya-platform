import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { EventHandler } from "@/application/ports/event-bus";
import type { SelfBillingAuthorizationGranted } from "@/domain/events/self-billing-authorization-granted";
import { InvoiceCreated } from "@/domain/events/invoice-created";
import { InvoiceSubmittedForAcceptance } from "@/domain/events/invoice-submitted-for-acceptance";
import { InvoiceAccepted } from "@/domain/events/invoice-accepted";
import { InvoiceIssued } from "@/domain/events/invoice-issued";
import { InvoicePaid } from "@/domain/events/invoice-paid";
import type { InvoiceCancelled } from "@/domain/events/invoice-cancelled";
import type { CreditNoteCreated } from "@/domain/events/credit-note-created";
import type { CreditNoteIssued } from "@/domain/events/credit-note-issued";

/**
 * Module 79 — Invoicing & Credit Notes: audit-log subscribers for every
 * legally/financially significant invoicing event the module brief lists
 * under "AUDIT TRAIL," mirroring `record-refund-audit-log.subscriber.ts`
 * (Module 77) exactly — one small class per event, translating it into
 * the existing `AdminAuditLogRepository.record` call, no business logic.
 * Reuses the existing append-only AuditLog trail rather than introducing
 * a second audit system — see that repository's own doc comment.
 *
 * `adminUserId: null` on the system-driven transitions (created,
 * submitted, issued, paid) — no human admin performed those; the acting
 * professional/company's own id is already recorded in `metadata` for
 * the human-driven ones (accepted). This mirrors
 * `RecordPaymentRefundedAuditLogSubscriber`'s own "system-triggered
 * entry with no human actor" reasoning.
 */

export class RecordSelfBillingAuditLogSubscriber implements EventHandler<SelfBillingAuthorizationGranted> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: SelfBillingAuthorizationGranted): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.acceptedByUserId,
      action: "SELF_BILLING_AUTHORIZATION_GRANTED",
      targetType: "SelfBillingAuthorization",
      targetId: event.authorizationId,
      metadata: {
        professionalProfileId: event.professionalProfileId,
        companyProfileId: event.companyProfileId,
        agreementVersion: event.agreementVersion,
      },
    });
  }
}

export class RecordInvoiceAuditLogSubscriber
  implements EventHandler<InvoiceCreated | InvoiceSubmittedForAcceptance | InvoiceAccepted | InvoiceIssued | InvoicePaid | InvoiceCancelled>
{
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(
    event: InvoiceCreated | InvoiceSubmittedForAcceptance | InvoiceAccepted | InvoiceIssued | InvoicePaid | InvoiceCancelled,
  ): Promise<void> {
    const { action, metadata } = this.describe(event);
    await this.auditLog.record({
      adminUserId: "acceptedByUserId" in event ? event.acceptedByUserId : "cancelledByUserId" in event ? event.cancelledByUserId : null,
      action,
      targetType: "Invoice",
      targetId: event.invoiceId,
      metadata,
    });
  }

  private describe(
    event: InvoiceCreated | InvoiceSubmittedForAcceptance | InvoiceAccepted | InvoiceIssued | InvoicePaid | InvoiceCancelled,
  ): { action: "INVOICE_CREATED" | "INVOICE_SUBMITTED_FOR_ACCEPTANCE" | "INVOICE_ACCEPTED" | "INVOICE_ISSUED" | "INVOICE_PAID" | "INVOICE_CANCELLED"; metadata: Record<string, unknown> } {
    // `instanceof` (not a switch on `event.eventName`) — `DomainEvent
    // .eventName`'s own declared return type is the widened `string`
    // (see that class's own doc comment on why: it is read reflectively
    // off the concrete subclass's static property), so it cannot
    // discriminate a union at the type-checker level the way a literal
    // string field could.
    if (event instanceof InvoiceCreated) {
      return { action: "INVOICE_CREATED", metadata: { jobId: event.jobId, professionalProfileId: event.professionalProfileId, companyProfileId: event.companyProfileId, totalAmount: event.totalAmount, currency: event.currency } };
    }
    if (event instanceof InvoiceSubmittedForAcceptance) {
      return { action: "INVOICE_SUBMITTED_FOR_ACCEPTANCE", metadata: { jobId: event.jobId, professionalProfileId: event.professionalProfileId, companyProfileId: event.companyProfileId } };
    }
    if (event instanceof InvoiceAccepted) {
      return {
        action: "INVOICE_ACCEPTED",
        metadata: { jobId: event.jobId, acceptedByUserId: event.acceptedByUserId, acceptedAt: event.acceptedAt.toISOString(), agreementVersion: event.agreementVersion },
      };
    }
    if (event instanceof InvoiceIssued) {
      return { action: "INVOICE_ISSUED", metadata: { jobId: event.jobId, invoiceNumber: event.invoiceNumber, totalAmount: event.totalAmount, currency: event.currency } };
    }
    if (event instanceof InvoicePaid) {
      return { action: "INVOICE_PAID", metadata: { jobId: event.jobId, totalAmount: event.totalAmount, currency: event.currency } };
    }
    // Only InvoiceCancelled remains — TypeScript can narrow this final
    // branch structurally even without eventName discrimination.
    return { action: "INVOICE_CANCELLED", metadata: { jobId: event.jobId, reason: event.reason, cancelledByUserId: event.cancelledByUserId } };
  }
}

export class RecordCreditNoteAuditLogSubscriber implements EventHandler<CreditNoteCreated | CreditNoteIssued> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: CreditNoteCreated | CreditNoteIssued): Promise<void> {
    if (event.eventName === "invoicing.credit-note-created") {
      const e = event as CreditNoteCreated;
      await this.auditLog.record({
        adminUserId: null,
        action: "CREDIT_NOTE_CREATED",
        targetType: "CreditNote",
        targetId: e.creditNoteId,
        metadata: { originalInvoiceId: e.originalInvoiceId, professionalProfileId: e.professionalProfileId, companyProfileId: e.companyProfileId, totalAmount: e.totalAmount, reason: e.reason },
      });
      return;
    }
    const e = event as CreditNoteIssued;
    await this.auditLog.record({
      adminUserId: null,
      action: "CREDIT_NOTE_ISSUED",
      targetType: "CreditNote",
      targetId: e.creditNoteId,
      metadata: { creditNoteNumber: e.creditNoteNumber, originalInvoiceId: e.originalInvoiceId, totalAmount: e.totalAmount },
    });
  }
}
