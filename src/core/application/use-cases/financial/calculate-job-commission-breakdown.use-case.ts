import { NotFoundError } from "@/domain/errors/domain-error";
import type { CommissionRateRepository } from "@/domain/repositories/commission-rate-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import {
  type CommissionBreakdown,
  type CommissionRates,
  calculateCommissionBreakdown,
} from "@/domain/services/commission-policy";

export interface JobCommissionBreakdownResult extends CommissionBreakdown {
  jobId: string;
  quoteId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  customerId: string;
  /** The rates actually used to produce this breakdown — snapshot these
   *  onto any persisted record (e.g. Commission.rateBps) rather than
   *  re-deriving them from the resulting amounts, which is lossy when the
   *  commission base is zero. */
  rates: CommissionRates;
}

/**
 * Module 22 — Commission & Financial: the single place that turns "a Job"
 * into "a full commission breakdown." Internal-use building block consumed
 * by RecordCommissionForPaymentUseCase, GetProfessionalEarningsUseCase,
 * GetCustomerFinancialSummaryUseCase, and CreateFinancialAdjustmentUseCase
 * — never called directly by a Server Action, since its output
 * (CommissionBreakdown) includes fields (commission,
 * platformGrossRevenue) that must never be shown to a customer, and other
 * fields a professional must never see for a Job that isn't theirs. Every
 * caller is responsible for its own authorization and for projecting only
 * the fields its own audience is allowed to see (see financial.dto.ts's
 * CustomerFinancialSummaryDTO/ProfessionalEarningsDTO).
 *
 * Deliberately does NOT charge or recognize anything — this is a pure
 * read+calculate operation. Following the module spec's lifecycle
 * requirement ("Do NOT charge or recognize professional commission simply
 * because a quote was created"), calculating a breakdown for a Job is
 * always safe to do at any point in the Job's lifecycle (it's just
 * arithmetic over the accepted Quote's line items); *recording* a
 * Commission (i.e. writing to the ledger) only ever happens in
 * RecordCommissionForPaymentUseCase, gated on the underlying Payment
 * actually being CAPTURED.
 */
export class CalculateJobCommissionBreakdownUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly quotes: QuoteRepository,
    private readonly rates: CommissionRateRepository,
  ) {}

  async execute(jobId: string): Promise<JobCommissionBreakdownResult> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const quote = await this.quotes.findById(job.quoteId);
    if (!quote) {
      throw new NotFoundError("Quote", job.quoteId);
    }

    let laborSubtotal = 0;
    let materialsSubtotal = 0;
    for (const item of quote.items) {
      if (item.category === "MATERIALS") {
        materialsSubtotal += item.amount;
      } else {
        laborSubtotal += item.amount;
      }
    }

    const rates = await this.rates.getCurrentRates();
    const breakdown = calculateCommissionBreakdown({ laborSubtotal, materialsSubtotal, rates });

    return {
      ...breakdown,
      jobId: job.id,
      quoteId: quote.id,
      professionalProfileId: job.professionalProfileId,
      companyProfileId: job.companyProfileId,
      customerId: job.customerId,
      rates,
    };
  }
}
