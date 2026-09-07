import { ValidationError } from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canActOnBehalfOfCompanyJob } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access: "our invoices" for a company. Ownership/authorization resolved
 * via `resolveCompanyActor` — same "not yours looks identical to doesn't
 * exist" convention every other company-scoped use case in this codebase
 * follows (a `companyId` the caller has no ACTIVE membership in surfaces
 * as `NotFoundError`, never a distinguishable "forbidden"). Viewing
 * invoices uses `canActOnBehalfOfCompanyJob` (OWNER/ADMIN/MANAGER) —
 * deliberately less restrictive than the OWNER/ADMIN-only
 * `canManageCompanyProfile` gate on granting/revoking self-billing
 * authorization itself (a legal/financial commitment), since viewing the
 * company's own already-issued invoices is the same class of visibility
 * `resolveJobActor`'s own company branch already grants a MANAGER for
 * Job-related data.
 */
export class ListInvoicesForCompanyUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly companyMembers: CompanyMembershipRepository,
  ) {}

  async execute(
    userId: string,
    companyId: string,
    page: { limit?: number; offset?: number } = {},
  ): Promise<InvoiceRecord[]> {
    const limit = page.limit ?? DEFAULT_PAGE_SIZE;
    const offset = page.offset ?? 0;
    if (limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError(`limit must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    if (offset < 0) {
      throw new ValidationError("offset cannot be negative.");
    }

    const actor = await resolveCompanyActor(userId, companyId, this.companyMembers);
    if (!canActOnBehalfOfCompanyJob(actor.role)) {
      return [];
    }

    return this.invoices.listForCompany(companyId, { limit, offset });
  }
}
