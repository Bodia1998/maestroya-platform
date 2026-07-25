import { ValidationError } from "@/domain/errors/domain-error";
import type { CommissionRepository } from "@/domain/repositories/commission-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { roundToCents } from "@/domain/services/money";
import type { ProfessionalEarningsDTO } from "@/application/dto/financial.dto";
import type { CalculateJobCommissionBreakdownUseCase } from "./calculate-job-commission-breakdown.use-case";

/**
 * Module 22 — Commission & Financial: professional/company-facing earnings
 * listing. Ownership is always re-derived from the authenticated session's
 * own ProfessionalProfile (same "never trust a client-supplied id" pattern
 * as resolveJobActor/resolveDisputeActor) — this use case has no
 * `professionalProfileId` parameter at all, only `userId`, so there is no
 * way to call it and get back someone else's earnings.
 *
 * Never exposes: another professional's commission, the customer's
 * platform fee, or MaestroYa's own gross revenue — see
 * ProfessionalEarningsDTO's own doc comment in financial.dto.ts.
 *
 * Company-side earnings (CompanyProfile) are out of scope here, same
 * limitation resolveJobActor already documents for company-owned Jobs —
 * this module doesn't invent company-membership-aware resolution that
 * doesn't otherwise exist.
 */
export class GetProfessionalEarningsUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly commissions: CommissionRepository,
    private readonly payments: PaymentRepository,
    private readonly breakdowns: CalculateJobCommissionBreakdownUseCase,
  ) {}

  async execute(userId: string): Promise<ProfessionalEarningsDTO[]> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("You must have a professional profile to view earnings.");
    }

    const commissions = await this.commissions.listForProfessional(professional.id);

    const results: ProfessionalEarningsDTO[] = [];
    for (const commission of commissions) {
      const payment = await this.payments.findById(commission.paymentId);
      if (!payment?.jobId) {
        continue;
      }
      const breakdown = await this.breakdowns.execute(payment.jobId);
      const professionalNetLaborEarnings = roundToCents(breakdown.laborSubtotal - commission.amount);
      const professionalTotalNetEarnings = roundToCents(professionalNetLaborEarnings + breakdown.materialsSubtotal);

      results.push({
        commissionId: commission.id,
        paymentId: commission.paymentId,
        jobId: payment.jobId,
        rateBps: commission.rateBps,
        laborSubtotal: breakdown.laborSubtotal,
        professionalCommission: commission.amount,
        professionalNetLaborEarnings,
        materialsReimbursed: breakdown.materialsSubtotal,
        professionalTotalNetEarnings,
        status: commission.status,
        settledAt: commission.settledAt,
      });
    }

    return results;
  }
}
