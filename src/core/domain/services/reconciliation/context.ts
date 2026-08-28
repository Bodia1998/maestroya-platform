import type { JobCommissionBreakdownResult } from "@/application/use-cases/financial/calculate-job-commission-breakdown.use-case";
import type { JobTaxBreakdownResult } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import type { CommissionRecord } from "@/domain/repositories/commission-repository";
import type { CreditNoteRecord } from "@/domain/repositories/credit-note-repository";
import type { InvoiceRecord } from "@/domain/repositories/invoice-repository";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { PayoutRecord } from "@/domain/repositories/payout-repository";
import type { RefundRecord } from "@/domain/repositories/refund-repository";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * One `JobFinancialContext` is gathered per Job by
 * `ReconciliationDataSource` (`application/ports/reconciliation-data-source.ts`)
 * and handed to every check module below. This is Module 80's own
 * read-side aggregate — it never re-derives a financial figure itself;
 * `commissionBreakdown`/`taxBreakdown` are the live outputs of the exact
 * same authoritative use cases (`CalculateJobCommissionBreakdownUseCase` /
 * `CalculateJobTaxBreakdownUseCase`, Modules 64/78) Modules 22/78/79
 * themselves call, so every check compares "what was recorded" against
 * "what the single source of truth says right now" — never a second,
 * independently-implemented formula.
 */
export interface JobFinancialContext {
  jobId: string;
  jobStatus: string;
  quoteId: string;
  quoteCurrency: string;
  quoteTotalAmount: number;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  customerId: string;

  payments: PaymentRecord[];
  commission: CommissionRecord | null;
  /** `null` only if the live recomputation itself threw (e.g. an
   *  inconsistent CommissionRateRepository state) — treated as its own
   *  finding by the caller, never silently swallowed. */
  commissionBreakdown: JobCommissionBreakdownResult | null;
  taxBreakdown: JobTaxBreakdownResult | null;

  invoices: InvoiceRecord[];
  payout: PayoutRecord | null;
  refunds: RefundRecord[];
  creditNotes: CreditNoteRecord[];

  /** Whether this Job's payment-release decision has reached
   *  RELEASE_APPROVED — reused as-is from Module 66's own persisted
   *  decision (`JobCompletionConfirmation.releaseStatus`), never
   *  re-evaluated here. */
  releaseApproved: boolean;
}
