import { ValidationError } from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access: "my receipts" for the signed-in customer — mirrors
 * `ListJobsForCustomerUseCase`'s exact shape (Module 11). `userId` always
 * comes from the server-side session and is resolved to the caller's own
 * `CustomerProfile`; a signed-in user with no `CustomerProfile` yet simply
 * has no receipts — returns an empty list rather than an error, same
 * convention as the Job list.
 */
export class ListInvoicesForCustomerUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly customerProfiles: CustomerProfileRepository,
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

    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      return [];
    }

    return this.invoices.listForCustomer(customer.id, { limit, offset });
  }
}
