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

/**
 * Module 23 — Analytics: a second narrow seam on this same interface,
 * added for the customer-facing "total spending" analytics metric. Same
 * justification as `getPlatformRevenueAggregate` above (a purpose-built
 * reporting method on Module 22's own boundary, not a duplicate
 * calculation living in Module 23) — this sums `Payment.amount`/
 * `Refund.amount` verbatim, the same stored figures Module 22 already
 * treats as authoritative, and never recomputes a commission, platform
 * fee, or net-earnings figure (those remain professional-earnings-only
 * concerns, out of scope for a customer's own spend summary — see
 * CustomerFinancialSummaryDTO's doc comment on what a customer is allowed
 * to see). Keyed by `payerId` (User.id, matching Payment.payerId) rather
 * than a CustomerProfile id, since Payment itself is keyed that way.
 */
export interface CustomerSpendAggregate {
  totalPaid: number;
  refundsTotal: number;
  paymentCount: number;
}

export interface FinancialReportingRepository {
  getPlatformRevenueAggregate(range: PlatformRevenueDateRange): Promise<PlatformRevenueAggregate>;
  getCustomerSpendAggregate(payerId: string, range: PlatformRevenueDateRange): Promise<CustomerSpendAggregate>;
}
