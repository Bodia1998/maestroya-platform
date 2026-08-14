/**
 * Module 65 — Trust & Integrity System: payment-abuse rule engine —
 * architecture only, per the module brief's requirement #13 ("Architecture
 * only. Future integration with Stripe."). This file defines the pure
 * detection rules against caller-supplied counts; nothing here calls
 * Stripe or any payment gateway directly — `application/ports/` has no
 * Stripe-specific port for this module because none of Module 65's own
 * use cases need one yet (a future module wiring real chargeback webhooks
 * would gather the counts this file consumes and call in here, exactly
 * like every other Module 65 detector).
 */

export interface ChargebackActivityInput {
  userId: string;
  chargebacksInWindow: number;
  successfulPaymentsInWindow: number;
}

export const CHARGEBACK_RATE_THRESHOLD = 0.02; // 2%
export const CHARGEBACK_MIN_SAMPLE = 5;

export interface RefundActivityInput {
  userId: string;
  refundsRequestedInWindow: number;
  completedJobsInWindow: number;
}

export const REFUND_ABUSE_RATE_THRESHOLD = 0.5;
export const REFUND_ABUSE_MIN_SAMPLE = 4;

export interface PaymentManipulationInput {
  userId: string;
  /** Payments where the captured amount didn't match the Quote total the
   *  payment claims to settle — the caller derives this by comparing
   *  `Payment.amount` against `calculateCommissionBreakdown`'s
   *  `customerTotalPayable` (Module 64), never re-implemented here. */
  amountMismatchCount: number;
  /** Distinct payment methods used by this single user within the window
   *  — rapid method-cycling is a common card-testing/stolen-card pattern. */
  distinctPaymentMethodsInWindow: number;
}

export const PAYMENT_METHOD_CYCLING_THRESHOLD = 4;

export interface PaymentAbuseFinding {
  reason: "CHARGEBACK_ABUSE" | "REFUND_ABUSE" | "PAYMENT_AMOUNT_MISMATCH" | "PAYMENT_METHOD_CYCLING";
  userId: string;
  detail: string;
}

/** Requirement #13 — "chargeback abuse". */
export function detectChargebackAbuse(input: ChargebackActivityInput): PaymentAbuseFinding | null {
  if (input.successfulPaymentsInWindow < CHARGEBACK_MIN_SAMPLE) return null;
  const rate = input.chargebacksInWindow / input.successfulPaymentsInWindow;
  if (rate < CHARGEBACK_RATE_THRESHOLD) return null;
  return {
    reason: "CHARGEBACK_ABUSE",
    userId: input.userId,
    detail: `${input.chargebacksInWindow} chargebacks out of ${input.successfulPaymentsInWindow} payments (${(rate * 100).toFixed(1)}%, threshold ${(CHARGEBACK_RATE_THRESHOLD * 100).toFixed(1)}%).`,
  };
}

/** Requirement #13 — "refund abuse". */
export function detectRefundAbuse(input: RefundActivityInput): PaymentAbuseFinding | null {
  if (input.completedJobsInWindow < REFUND_ABUSE_MIN_SAMPLE) return null;
  const rate = input.refundsRequestedInWindow / input.completedJobsInWindow;
  if (rate < REFUND_ABUSE_RATE_THRESHOLD) return null;
  return {
    reason: "REFUND_ABUSE",
    userId: input.userId,
    detail: `${input.refundsRequestedInWindow} refund requests out of ${input.completedJobsInWindow} completed jobs (${(rate * 100).toFixed(0)}%, threshold ${(REFUND_ABUSE_RATE_THRESHOLD * 100).toFixed(0)}%).`,
  };
}

/** Requirement #13 — "payment manipulation": amount mismatches and rapid
 *  payment-method cycling. */
export function detectPaymentManipulation(input: PaymentManipulationInput): PaymentAbuseFinding[] {
  const findings: PaymentAbuseFinding[] = [];

  if (input.amountMismatchCount > 0) {
    findings.push({
      reason: "PAYMENT_AMOUNT_MISMATCH",
      userId: input.userId,
      detail: `${input.amountMismatchCount} payment(s) whose captured amount did not match the Quote's computed total.`,
    });
  }

  if (input.distinctPaymentMethodsInWindow >= PAYMENT_METHOD_CYCLING_THRESHOLD) {
    findings.push({
      reason: "PAYMENT_METHOD_CYCLING",
      userId: input.userId,
      detail: `${input.distinctPaymentMethodsInWindow} distinct payment methods used within the detection window (threshold ${PAYMENT_METHOD_CYCLING_THRESHOLD}).`,
    });
  }

  return findings;
}
