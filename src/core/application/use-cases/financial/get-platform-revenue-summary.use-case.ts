import type { FinancialReportingRepository } from "@/domain/repositories/financial-reporting-repository";
import { roundToCents } from "@/domain/services/money";
import type {
  GetPlatformRevenueSummaryInput,
  PlatformRevenueSummaryDTO,
} from "@/application/dto/financial.dto";

/**
 * Module 22 — Commission & Financial: admin-only platform revenue summary.
 * Authorization is enforced by the caller (a Server Action calling
 * `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)` before invoking this, same
 * convention as every admin use case — see admin/disputes/actions.ts) —
 * this use case itself has no notion of "who is asking," it only knows how
 * to aggregate. Deliberately a thin wrapper, not a dashboard: no charts, no
 * trends, no drill-down — see GetAdminDashboardOverviewUseCase's own doc
 * comment on the same boundary for Module 16, and the module spec's
 * "Module 23 Analytics boundary" (Module 22 provides authoritative
 * numbers; Module 23 owns visualization/trends).
 */
export class GetPlatformRevenueSummaryUseCase {
  constructor(private readonly reporting: FinancialReportingRepository) {}

  async execute(input: GetPlatformRevenueSummaryInput): Promise<PlatformRevenueSummaryDTO> {
    const aggregate = await this.reporting.getPlatformRevenueAggregate({
      from: input.from,
      to: input.to,
    });

    return {
      from: input.from ?? null,
      to: input.to ?? null,
      grossLaborVolume: roundToCents(aggregate.grossLaborVolume),
      grossMaterialsVolume: roundToCents(aggregate.grossMaterialsVolume),
      customerPlatformFees: roundToCents(aggregate.customerPlatformFees),
      professionalCommissions: roundToCents(aggregate.professionalCommissions),
      platformGrossRevenue: roundToCents(aggregate.customerPlatformFees + aggregate.professionalCommissions),
      refundsTotal: roundToCents(aggregate.refundsTotal),
      disputeAdjustmentsTotal: roundToCents(aggregate.disputeAdjustmentsTotal),
      payoutsTotal: roundToCents(aggregate.payoutsTotal),
      paymentCount: aggregate.paymentCount,
    };
  }
}
