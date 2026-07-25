import { z } from "zod";

/**
 * Module 22 — Commission & Financial. Same convention as every other
 * `*.dto.ts` in this codebase (see dispute.dto.ts/quote.dto.ts): zod
 * schemas shared by a Server Action's input validation and (where useful)
 * a client form.
 *
 * As with quote.dto.ts's totalAmount, nothing here ever accepts a
 * client-supplied money amount for a *calculated* figure (commission,
 * platform fee, net earnings) — those are always derived server-side from
 * Quote/QuoteItem via commission-policy.ts. The only amount a schema below
 * accepts directly is a FinancialAdjustment's `amount`, and only from an
 * admin/support caller already gated by `requireRole` in the Server Action
 * — never from a customer or professional.
 */

export const getJobCommissionBreakdownSchema = z.object({
  jobId: z.string().uuid("Invalid job."),
});
export type GetJobCommissionBreakdownInput = z.infer<typeof getJobCommissionBreakdownSchema>;

export const recordCommissionForPaymentSchema = z.object({
  paymentId: z.string().uuid("Invalid payment."),
});
export type RecordCommissionForPaymentInput = z.infer<typeof recordCommissionForPaymentSchema>;

export const financialAdjustmentTypeSchema = z.enum([
  "FULL_REFUND",
  "PARTIAL_REFUND",
  "PROFESSIONAL_PAYOUT_REDUCTION",
  "PROFESSIONAL_PAYOUT_RELEASE",
  "CUSTOMER_COMPENSATION",
  "PLATFORM_FEE_REFUND",
  "COMMISSION_REVERSAL",
]);

export const MAX_ADJUSTMENT_REASON_LENGTH = 2000;
export const MAX_ADJUSTMENT_AMOUNT = 1000000;

export const createFinancialAdjustmentSchema = z.object({
  jobId: z.string().uuid("Invalid job."),
  disputeId: z.string().uuid("Invalid dispute.").optional(),
  paymentId: z.string().uuid("Invalid payment.").optional(),
  type: financialAdjustmentTypeSchema,
  amount: z.coerce
    .number()
    .positive("Adjustment amount must be greater than zero.")
    .max(MAX_ADJUSTMENT_AMOUNT, "Enter a realistic adjustment amount."),
  reason: z.string().trim().max(MAX_ADJUSTMENT_REASON_LENGTH).optional().or(z.literal("")),
});
export type CreateFinancialAdjustmentInput = z.infer<typeof createFinancialAdjustmentSchema>;

export const getPlatformRevenueSummarySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type GetPlatformRevenueSummaryInput = z.infer<typeof getPlatformRevenueSummarySchema>;

/**
 * Customer-facing projection of a Payment's finances. Deliberately absent:
 * professionalCommission, professionalNetLaborEarnings, platformGrossRevenue,
 * rateBps — a customer never sees the professional's own commission/earnings
 * or the platform's revenue, only what they themselves were charged and
 * why. See docs/MODULE_22_COMMISSION_FINANCIAL.md, "Authorization."
 */
export interface CustomerFinancialSummaryDTO {
  paymentId: string;
  jobId: string | null;
  laborSubtotal: number;
  materialsSubtotal: number;
  customerPlatformFee: number;
  totalPaid: number;
  currency: string;
  refundedAmount: number;
  status: string;
}

/**
 * Professional/company-facing projection — their own commission and net
 * earnings only, never another professional's, never the customer's
 * platform fee or the platform's total revenue.
 */
export interface ProfessionalEarningsDTO {
  commissionId: string;
  paymentId: string;
  jobId: string | null;
  rateBps: number;
  laborSubtotal: number;
  professionalCommission: number;
  professionalNetLaborEarnings: number;
  materialsReimbursed: number;
  professionalTotalNetEarnings: number;
  status: string;
  settledAt: Date | null;
}

/** Admin-only aggregate — see GetPlatformRevenueSummaryUseCase. */
export interface PlatformRevenueSummaryDTO {
  from: Date | null;
  to: Date | null;
  grossLaborVolume: number;
  grossMaterialsVolume: number;
  customerPlatformFees: number;
  professionalCommissions: number;
  platformGrossRevenue: number;
  refundsTotal: number;
  disputeAdjustmentsTotal: number;
  payoutsTotal: number;
  paymentCount: number;
}
