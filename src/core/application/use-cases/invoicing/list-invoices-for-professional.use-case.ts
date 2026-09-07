import { ValidationError } from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access: "my invoices" for the signed-in solo professional — mirrors
 * `ListJobsForProfessionalUseCase`'s exact shape and its same explicit
 * "company-owned invoices are out of scope for this list" limitation (see
 * `ListInvoicesForCompanyUseCase` for the company-side equivalent).
 */
export class ListInvoicesForProfessionalUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(userId: string, page: { limit?: number; offset?: number } = {}): Promise<InvoiceRecord[]> {
    const limit = page.limit ?? DEFAULT_PAGE_SIZE;
    const offset = page.offset ?? 0;
    if (limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError(`limit must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    if (offset < 0) {
      throw new ValidationError("offset cannot be negative.");
    }

    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      return [];
    }

    return this.invoices.listForProfessional(professional.id, { limit, offset });
  }
}
