import { IssueLeadFeeCreditNoteUseCase } from "@/application/use-cases/lead-fee-credit-note/issue-lead-fee-credit-note.use-case";
import { resolveLeadFeeCreditNoteIssuanceConfig } from "@/domain/services/lead-fee-credit-note";
import { PrismaLeadFeeCreditNoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-credit-note-repository";
import { PrismaLeadFeeInvoiceRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository";

/**
 * Module 151 — composition root of the lead-fee credit note (plain factory, no DI container).
 *
 * TRUSTED-INTERNAL: callers must pass a persisted lead-purchase id and must never be reachable from the browser.
 * Nothing in the application calls this today (no route, Server Action, webhook, job or queue; no admin console before
 * M157). Settings are read from the environment on every call and fail CLOSED when the issuer (M150 variables) or the
 * CREDIT-NOTE policy-approval reference is not configured — see docs/MODULE_151_LEAD_FEE_CREDIT_NOTES.md.
 */
export function makeIssueLeadFeeCreditNoteUseCase() {
  return new IssueLeadFeeCreditNoteUseCase(
    new PrismaLeadFeeInvoiceRepository(),
    new PrismaLeadFeeCreditNoteRepository(),
    () => resolveLeadFeeCreditNoteIssuanceConfig(process.env),
  );
}
