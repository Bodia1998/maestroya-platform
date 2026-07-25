import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  FinancialReportingRepository,
  PlatformRevenueAggregate,
  PlatformRevenueDateRange,
} from "@/domain/repositories/financial-reporting-repository";

function dateFilter(range: PlatformRevenueDateRange) {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

/**
 * Module 22 — Commission & Financial: admin platform revenue aggregate.
 * Reads from the append-only `Transaction` ledger for the money-movement
 * figures (labor/materials volume, customer fees, professional
 * commissions — each is written as its own typed ledger entry by
 * RecordCommissionForPaymentUseCase) and from `FinancialAdjustment`/
 * `Payout` directly for adjustment/payout totals, since those aren't
 * (yet) fully mirrored into per-type ledger rows beyond DISPUTE_ADJUSTMENT/
 * COMMISSION_REVERSAL.
 */
export class PrismaFinancialReportingRepository implements FinancialReportingRepository {
  async getPlatformRevenueAggregate(range: PlatformRevenueDateRange): Promise<PlatformRevenueAggregate> {
    const createdAt = dateFilter(range);
    const txWhere = createdAt ? { createdAt } : {};

    const [labor, materials, customerFees, commissions, adjustments, refunds, payouts, paymentCount] = await Promise.all([
      prisma.transaction.aggregate({
        where: { ...txWhere, type: "LABOR_CHARGE", status: "COMPLETED" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { ...txWhere, type: "MATERIALS_CHARGE", status: "COMPLETED" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { ...txWhere, type: "CUSTOMER_PLATFORM_FEE", status: "COMPLETED" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { ...txWhere, type: "COMMISSION", status: "COMPLETED" },
        _sum: { amount: true },
      }),
      prisma.financialAdjustment.aggregate({
        where: { status: "APPLIED", ...(createdAt ? { appliedAt: createdAt } : {}) },
        _sum: { amount: true },
      }),
      prisma.financialAdjustment.aggregate({
        where: {
          status: "APPLIED",
          type: { in: ["FULL_REFUND", "PARTIAL_REFUND", "PLATFORM_FEE_REFUND"] },
          ...(createdAt ? { appliedAt: createdAt } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.payout.aggregate({
        where: { status: "PAID", ...(createdAt ? { processedAt: createdAt } : {}) },
        _sum: { amount: true },
      }),
      prisma.payment.count({
        where: { status: "CAPTURED", ...(createdAt ? { capturedAt: createdAt } : {}) },
      }),
    ]);

    return {
      grossLaborVolume: Number(labor._sum.amount ?? 0),
      grossMaterialsVolume: Number(materials._sum.amount ?? 0),
      customerPlatformFees: Number(customerFees._sum.amount ?? 0),
      professionalCommissions: Number(commissions._sum.amount ?? 0),
      refundsTotal: Number(refunds._sum.amount ?? 0),
      disputeAdjustmentsTotal: Number(adjustments._sum.amount ?? 0),
      payoutsTotal: Number(payouts._sum.amount ?? 0),
      paymentCount,
    };
  }
}
