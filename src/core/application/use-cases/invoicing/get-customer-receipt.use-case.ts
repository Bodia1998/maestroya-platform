import { NotFoundError } from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { CreditNoteRecord, CreditNoteRepository } from "@/domain/repositories/credit-note-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";

export interface CustomerReceiptView {
  invoice: InvoiceRecord;
  creditNotes: CreditNoteRecord[];
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Single-receipt detail lookup for the customer-facing route
 * (`/receipts/[id]`). Ownership is enforced the same way
 * `resolveJobActor`'s own doc comment describes: an invoice that exists
 * but does not belong to the caller, and one that does not exist at all,
 * both surface as the identical `NotFoundError` — never a distinguishable
 * "exists but isn't yours" response an attacker could use to enumerate
 * valid invoice ids. Also rejects a `PROFESSIONAL_SELF_BILLED` invoice id
 * the same way (a customer has no legitimate reason to ever resolve one,
 * even their own job's) — this route only ever serves `CUSTOMER_RECEIPT`
 * documents.
 */
export class GetCustomerReceiptUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly creditNotes: CreditNoteRepository,
    private readonly customerProfiles: CustomerProfileRepository,
  ) {}

  async execute(userId: string, invoiceId: string): Promise<CustomerReceiptView> {
    const customer = await this.customerProfiles.findByUserId(userId);
    const invoice = await this.invoices.findById(invoiceId);

    if (!customer || !invoice || invoice.type !== "CUSTOMER_RECEIPT" || invoice.customerId !== customer.id) {
      throw new NotFoundError("Invoice", invoiceId);
    }

    const creditNotes = await this.creditNotes.listByOriginalInvoiceId(invoice.id);
    return { invoice, creditNotes };
  }
}
