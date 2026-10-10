import { makeGetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/compose";
import { IssueLeadFeeInvoiceUseCase } from "@/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice.use-case";
import { resolveLeadFeeInvoiceIssuanceConfig } from "@/domain/services/lead-fee-invoice";
import { PrismaLeadFeeInvoiceRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository";
import { PrismaLeadFeeRevenueLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";

/**
 * Module 150 — composition root of the lead-fee invoice (plain factory, no DI container).
 *
 * TRUSTED-INTERNAL: callers must pass a persisted lead-purchase id and must never be reachable from the browser.
 * Nothing in the application calls this today (no automatic issuance, no admin console before M157). Issuance
 * settings are read from the environment on every call and fail CLOSED when the issuer (legal name, tax id,
 * address) or the policy-approval reference is not configured — see docs/MODULE_150_LEAD_FEE_INVOICE.md.
 */
export function makeIssueLeadFeeInvoiceUseCase() {
  return new IssueLeadFeeInvoiceUseCase(
    new PrismaLeadFeeRevenueLedgerRepository(),
    new PrismaLeadPurchaseRepository(),
    makeGetProfessionalBillingReadinessUseCase(),
    new PrismaLeadFeeInvoiceRepository(),
    () => resolveLeadFeeInvoiceIssuanceConfig(process.env),
  );
}
