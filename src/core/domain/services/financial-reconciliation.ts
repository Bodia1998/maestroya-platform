import type { CommissionRecord } from "@/domain/repositories/commission-repository";
import type { FinancialTransactionRecord } from "@/domain/repositories/financial-ledger-repository";
import type { PaymentStatusValue } from "@/domain/repositories/payment-repository";
import type { PaymentReleaseStatus } from "@/domain/services/payment-release-decision";

/**
 * Module 69 — Financial Ledger & Payout Readiness Audit.
 *
 * The single, pure, read-only function that answers "is this Payment's
 * financial chain internally consistent?" — Section 14's reconciliation
 * requirement. Deliberately a pure function (no I/O, no Prisma, no Stripe),
 * mirroring `payment-release-decision.ts`'s own convention exactly: the
 * calling use case (`ReconcilePaymentUseCase`) gathers every already-
 * persisted fact from the relevant repositories and this function only
 * *evaluates* them. NEVER repairs or mutates anything it inspects — per
 * this module's non-negotiable safety rule ("Never silently repair
 * historical financial data"), an inconsistency is always reported, never
 * fixed automatically.
 *
 * ## What "consistent" means here
 * A Payment's financial chain is internally consistent when every ledger
 * entry it produced is mutually derivable from the others under the exact
 * formulas `commission-calculation-service.ts`/
 * `record-commission-for-payment.use-case.ts` already establish as
 * authoritative — this function never invents a different formula, it only
 * checks the existing one was actually followed. See each
 * `ReconciliationIssueCode`'s own comment below for the specific check.
 */

export type ReconciliationIssueCode =
  | "MISSING_COMMISSION_FOR_RECOGNIZED_EARNING"
  | "MISSING_NET_EARNING_LEDGER_ENTRY"
  | "COMMISSION_LEDGER_AMOUNT_MISMATCH"
  | "NET_EARNING_DOES_NOT_MATCH_COMMISSION_BASE"
  | "REFUND_EXCEEDS_CAPTURED_AMOUNT"
  | "CURRENCY_MISMATCH"
  | "EARNING_RECOGNIZED_WITHOUT_RELEASE_APPROVED";

export interface ReconciliationIssue {
  code: ReconciliationIssueCode;
  detail: string;
}

export interface PaymentReconciliationInput {
  payment: {
    id: string;
    amount: number;
    currency: string;
    status: PaymentStatusValue;
  };
  commission: CommissionRecord | null;
  /** Every ledger `Transaction` row for this Payment — the full,
   *  append-only history, not a projection. */
  ledgerEntries: readonly FinancialTransactionRecord[];
  /** Sum of every `APPLIED` `FULL_REFUND`/`PARTIAL_REFUND`/
   *  `PLATFORM_FEE_REFUND` `FinancialAdjustment` against this Payment — see
   *  `FinancialAdjustmentRepository.sumAppliedAmountForPayment`. Passed in
   *  (not re-derived from `ledgerEntries`) because a refund-type adjustment
   *  is recorded on the ledger as a signed `DISPUTE_ADJUSTMENT`/
   *  `COMMISSION_REVERSAL` entry, not its own dedicated ledger type — this
   *  keeps the "is refund-boundedness actually holding" check anchored to
   *  the same authoritative source `CreateFinancialAdjustmentUseCase`'s own
   *  Invariant-8 guard uses, not a second, potentially-diverging
   *  derivation. */
  appliedRefundAdjustmentsTotal: number;
  /** From `JobCompletionConfirmation.releaseStatus` — `null` if the Job has
   *  no completion confirmation at all yet. */
  releaseStatus: PaymentReleaseStatus | null;
}

export interface PaymentReconciliationReport {
  paymentId: string;
  consistent: boolean;
  issues: readonly ReconciliationIssue[];
  commissionAmount: number | null;
  professionalNetEarning: number | null;
  platformRevenue: number | null;
  totalRefunded: number;
  /** Net amount currently recognized as owed to the professional/company —
   *  the `PROFESSIONAL_NET_EARNING` ledger entry (if any) plus every signed
   *  `DISPUTE_ADJUSTMENT`/`COMMISSION_REVERSAL`/`PAYOUT_REVERSAL` ledger
   *  entry for the same Payment (already signed correctly by
   *  `CreateFinancialAdjustmentUseCase` — negative for a reduction/refund,
   *  positive for a `PROFESSIONAL_PAYOUT_RELEASE`). `null` when no
   *  `PROFESSIONAL_NET_EARNING` entry exists yet — nothing has been
   *  recognized, so there is nothing to net against. This is NOT "amount
   *  already paid out" — Module 69 does not track per-Payment payouts (see
   *  `check-payout-readiness.use-case.ts`'s own doc comment on why that
   *  figure only exists at the professional-aggregate level). */
  amountPayableToProfessional: number | null;
}

const ADJUSTING_LEDGER_TYPES = new Set(["DISPUTE_ADJUSTMENT", "COMMISSION_REVERSAL", "PAYOUT_REVERSAL"]);

function amountsRoughlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

export function reconcilePayment(input: PaymentReconciliationInput): PaymentReconciliationReport {
  const issues: ReconciliationIssue[] = [];

  const laborEntry = input.ledgerEntries.find((e) => e.type === "LABOR_CHARGE");
  const materialsEntry = input.ledgerEntries.find((e) => e.type === "MATERIALS_CHARGE");
  const commissionEntry = input.ledgerEntries.find((e) => e.type === "COMMISSION");
  const netEarningEntry = input.ledgerEntries.find((e) => e.type === "PROFESSIONAL_NET_EARNING");
  const platformRevenueEntry = input.ledgerEntries.find((e) => e.type === "PLATFORM_REVENUE");

  // --- Currency consistency (Invariant 9) ---
  const mismatchedCurrency = input.ledgerEntries.find((e) => e.currency !== input.payment.currency);
  if (mismatchedCurrency) {
    issues.push({
      code: "CURRENCY_MISMATCH",
      detail: `Ledger entry ${mismatchedCurrency.id} is in ${mismatchedCurrency.currency}, but Payment ${input.payment.id} is in ${input.payment.currency}.`,
    });
  }

  // --- Commission <-> ledger cross-checks (Invariants 1, 2, 6, 10) ---
  if (input.commission && !netEarningEntry) {
    issues.push({
      code: "MISSING_NET_EARNING_LEDGER_ENTRY",
      detail: `Commission ${input.commission.id} exists for this payment but no PROFESSIONAL_NET_EARNING ledger entry was found.`,
    });
  }
  if (!input.commission && netEarningEntry) {
    issues.push({
      code: "MISSING_COMMISSION_FOR_RECOGNIZED_EARNING",
      detail: `A PROFESSIONAL_NET_EARNING ledger entry (${netEarningEntry.id}) exists but no Commission row is recorded for this payment.`,
    });
  }
  if (input.commission && commissionEntry && !amountsRoughlyEqual(input.commission.amount, commissionEntry.amount)) {
    issues.push({
      code: "COMMISSION_LEDGER_AMOUNT_MISMATCH",
      detail: `Commission.amount (${input.commission.amount}) does not match the COMMISSION ledger entry's amount (${commissionEntry.amount}).`,
    });
  }
  if (input.commission && netEarningEntry && laborEntry && materialsEntry !== undefined) {
    const commissionBase = laborEntry.amount + (materialsEntry?.amount ?? 0);
    const expectedNetEarning = commissionBase - input.commission.amount;
    if (!amountsRoughlyEqual(netEarningEntry.amount, expectedNetEarning)) {
      issues.push({
        code: "NET_EARNING_DOES_NOT_MATCH_COMMISSION_BASE",
        detail: `PROFESSIONAL_NET_EARNING (${netEarningEntry.amount}) does not equal commission base (${commissionBase}) minus commission (${input.commission.amount}) = ${expectedNetEarning}.`,
      });
    }
  }

  // --- Refund boundedness (Invariant 8) — reconciliation still checks this
  //     even though the DB trigger (migration 20260825000000) and the
  //     application-level guard should make it unreachable going forward;
  //     this catches historical data written before that fix existed. ---
  if (input.appliedRefundAdjustmentsTotal > input.payment.amount + 0.01) {
    issues.push({
      code: "REFUND_EXCEEDS_CAPTURED_AMOUNT",
      detail: `Applied refund-type adjustments (${input.appliedRefundAdjustmentsTotal}) exceed the captured amount (${input.payment.amount}).`,
    });
  }

  // --- No earnings before release approval (Invariant 3) ---
  if (netEarningEntry && input.releaseStatus !== "RELEASE_APPROVED") {
    issues.push({
      code: "EARNING_RECOGNIZED_WITHOUT_RELEASE_APPROVED",
      detail: `A PROFESSIONAL_NET_EARNING entry exists but the payment-release status is ${input.releaseStatus ?? "not evaluated"}, not RELEASE_APPROVED.`,
    });
  }

  const adjustingLedgerTotal = input.ledgerEntries
    .filter((e) => e.type !== undefined && ADJUSTING_LEDGER_TYPES.has(e.type) && e.paymentId === input.payment.id)
    .reduce((sum, e) => sum + e.amount, 0);

  return {
    paymentId: input.payment.id,
    consistent: issues.length === 0,
    issues,
    commissionAmount: input.commission?.amount ?? null,
    professionalNetEarning: netEarningEntry?.amount ?? null,
    platformRevenue: platformRevenueEntry?.amount ?? null,
    totalRefunded: input.appliedRefundAdjustmentsTotal,
    amountPayableToProfessional: netEarningEntry ? netEarningEntry.amount + adjustingLedgerTotal : null,
  };
}
