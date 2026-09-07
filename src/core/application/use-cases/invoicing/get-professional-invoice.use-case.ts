import { NotFoundError } from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { CreditNoteRecord, CreditNoteRepository } from "@/domain/repositories/credit-note-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canActOnBehalfOfCompanyJob } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

export interface ProfessionalInvoiceView {
  invoice: InvoiceRecord;
  creditNotes: CreditNoteRecord[];
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Single-invoice detail lookup for the professional/company-facing route
 * (`/dashboard/professional/invoices/[id]`). `companyId` is optional —
 * when supplied, ownership is checked via `resolveCompanyActor` (same
 * `canActOnBehalfOfCompanyJob` viewing gate as `ListInvoicesForCompanyUseCase`);
 * otherwise the invoice must belong to the caller's own solo
 * `ProfessionalProfile`. A `CUSTOMER_RECEIPT` id, an invoice belonging to
 * a different professional/company, or a nonexistent id are all rejected
 * identically — same anti-enumeration convention as
 * `GetCustomerReceiptUseCase`/`resolveJobActor`.
 */
export class GetProfessionalInvoiceUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly creditNotes: CreditNoteRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
  ) {}

  async execute(userId: string, invoiceId: string, companyId?: string | null): Promise<ProfessionalInvoiceView> {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice || invoice.type !== "PROFESSIONAL_SELF_BILLED") {
      throw new NotFoundError("Invoice", invoiceId);
    }

    if (companyId) {
      let allowed = false;
      try {
        const actor = await resolveCompanyActor(userId, companyId, this.companyMembers);
        allowed = canActOnBehalfOfCompanyJob(actor.role) && invoice.companyProfileId === companyId;
      } catch {
        allowed = false;
      }
      if (!allowed) {
        throw new NotFoundError("Invoice", invoiceId);
      }
    } else {
      const professional = await this.professionals.findByUserId(userId);
      if (!professional || invoice.professionalProfileId !== professional.id) {
        throw new NotFoundError("Invoice", invoiceId);
      }
    }

    const creditNotes = await this.creditNotes.listByOriginalInvoiceId(invoice.id);
    return { invoice, creditNotes };
  }
}
