/**
 * Module 22 — Commission & Financial: a single, narrow aggregate-query
 * seam for the admin-only platform revenue summary (see
 * GetPlatformRevenueSummaryUseCase). Kept separate from
 * CommissionRepository/PaymentRepository/FinancialLedgerRepository rather
 * than bolting reporting-specific `sum*` methods onto each of them — this
 * is Module 22's own authoritative-record focus (see the module spec:
 * "Module 22 should focus on authoritative financial records," analytics
 * proper is Module 23's job); this interface exists only to serve the one
 * admin aggregate this module is responsible for, not as a general
 * analytics API.
 */

export interface PlatformRevenueDateRange {
  from?: Date;
  to?: Date;
}

export interface PlatformRevenueAggregate {
  grossLaborVolume: number;
  grossMaterialsVolume: number;
  customerPlatformFees: number;
  professionalCommissions: number;
  refundsTotal: number;
  disputeAdjustmentsTotal: number;
  payoutsTotal: number;
  paymentCount: number;
}

export interface FinancialReportingRepository {
  getPlatformRevenueAggregate(range: PlatformRevenueDateRange): Promise<PlatformRevenueAggregate>;
}
