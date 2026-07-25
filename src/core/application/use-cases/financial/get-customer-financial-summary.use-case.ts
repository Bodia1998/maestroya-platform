import { NotFoundError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import { roundToCents } from "@/domain/services/money";
import type { CustomerFinancialSummaryDTO } from "@/application/dto/financial.dto";
import type { CalculateJobCommissionBreakdownUseCase } from "./calculate-job-commission-breakdown.use-case";

/**
 * Module 22 — Commission & Financial: customer-facing financial summary
 * for a single Job. Ownership is re-derived from the session
 * (CustomerProfileRepository.findByUserId compared against
 * Job.customerId), never trusted from a client-supplied customerId — a Job
 * the caller isn't the customer for surfaces as NotFoundError, same
 * anti-enumeration convention as resolveJobActor.
 *
 * Never exposes: the professional's commission or net earnings, or
 * MaestroYa's own gross revenue — see CustomerFinancialSummaryDTO's own
 * doc comment.
 */
export class GetCustomerFinancialSummaryUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly jobs: JobRepository,
    private readonly payments: PaymentRepository,
    private readonly breakdowns: CalculateJobCommissionBreakdownUseCase,
  ) {}

  async execute(userId: string, jobId: string): Promise<CustomerFinancialSummaryDTO[]> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer || customer.id !== job.customerId) {
      // Same job-exists-but-isn't-yours-collapses-to-NotFound convention as
      // resolveJobActor — never a distinguishable response an attacker
      // could use to probe for valid Job ids.
      throw new NotFoundError("Job", jobId);
    }

    const payments = await this.payments.findByJobId(jobId);
    if (payments.length === 0) {
      return [];
    }

    const breakdown = await this.breakdowns.execute(jobId);

    const results: CustomerFinancialSummaryDTO[] = [];
    for (const payment of payments) {
      const refundedAmount = await this.payments.sumProcessedRefunds(payment.id);
      results.push({
        paymentId: payment.id,
        jobId,
        laborSubtotal: breakdown.laborSubtotal,
        materialsSubtotal: breakdown.materialsSubtotal,
        customerPlatformFee: breakdown.customerPlatformFee,
        totalPaid: roundToCents(payment.amount),
        currency: payment.currency,
        refundedAmount: roundToCents(refundedAmount),
        status: payment.status,
      });
    }

    return results;
  }
}
