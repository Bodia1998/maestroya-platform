import { PrismaCommissionRateRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-rate-repository";
import { PrismaCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaFinancialAdjustmentRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-adjustment-repository";
import { PrismaFinancialLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-ledger-repository";
import { PrismaFinancialReportingRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-reporting-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaJobCompletionConfirmationRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-completion-confirmation-repository";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { CalculateJobCommissionBreakdownUseCase } from "./calculate-job-commission-breakdown.use-case";
import { CreateFinancialAdjustmentUseCase } from "./create-financial-adjustment.use-case";
import { GetCustomerFinancialSummaryUseCase } from "./get-customer-financial-summary.use-case";
import { GetPlatformRevenueSummaryUseCase } from "./get-platform-revenue-summary.use-case";
import { GetProfessionalEarningsUseCase } from "./get-professional-earnings.use-case";
import { RecordCommissionForPaymentUseCase } from "./record-commission-for-payment.use-case";

const jobs = new PrismaJobRepository();
const quotes = new PrismaQuoteRepository();
const rates = new PrismaCommissionRateRepository();
const commissions = new PrismaCommissionRepository();
const ledger = new PrismaFinancialLedgerRepository();
const payments = new PrismaPaymentRepository();
const adjustments = new PrismaFinancialAdjustmentRepository();
const reporting = new PrismaFinancialReportingRepository();
const professionals = new PrismaProfessionalRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
// Module 66 — Job Completion & Payment Release Protection: the source of
// truth RecordCommissionForPaymentUseCase reads its release gate from.
// Never a second instance elsewhere in this compose.ts — see
// job/compose.ts's own `completionConfirmations` for the equivalent
// instance used by Module 66's own use cases; this module intentionally
// constructs its own (matches this codebase's existing convention of
// each compose.ts owning its own cross-module Prisma repository
// instances rather than importing another feature's compose.ts).
const completionConfirmations = new PrismaJobCompletionConfirmationRepository();

const breakdowns = new CalculateJobCommissionBreakdownUseCase(jobs, quotes, rates);

export function makeCalculateJobCommissionBreakdownUseCase() {
  return breakdowns;
}

export function makeRecordCommissionForPaymentUseCase() {
  return new RecordCommissionForPaymentUseCase(payments, commissions, ledger, breakdowns, completionConfirmations);
}

export function makeGetProfessionalEarningsUseCase() {
  return new GetProfessionalEarningsUseCase(professionals, commissions, payments, breakdowns);
}

export function makeGetCustomerFinancialSummaryUseCase() {
  return new GetCustomerFinancialSummaryUseCase(customerProfiles, jobs, payments, breakdowns);
}

export function makeGetPlatformRevenueSummaryUseCase() {
  return new GetPlatformRevenueSummaryUseCase(reporting);
}

export function makeCreateFinancialAdjustmentUseCase() {
  return new CreateFinancialAdjustmentUseCase(jobs, adjustments, ledger);
}
