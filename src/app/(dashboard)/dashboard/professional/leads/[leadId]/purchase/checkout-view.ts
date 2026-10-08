import type { LeadPurchaseCheckoutDTO } from "@/application/dto/lead-purchase-checkout.dto";

/**
 * Module 144 — presentation-only helpers for the checkout page. Nothing here decides money,
 * eligibility, payment or contact access: those are M135/M136/M140/M141/M138 on the server.
 * This file only maps the AUTHORITATIVE backend purchase status to what the page shows.
 */

/**
 * Bounded status polling while Module 141's verified webhook confirms the payment: ~42 s in
 * total, then the page stops and offers a manual "check again". Never infinite.
 */
export const LEAD_PURCHASE_POLL_INTERVALS_MS: readonly number[] = [1500, 1500, 2000, 2000, 3000, 3000, 3000, 5000, 5000, 5000, 5000, 5000];

export type CheckoutPhaseName =
  | "review"
  | "starting"
  | "preparing"
  | "payment"
  | "awaiting"
  | "timeout"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "unavailable"
  | "error";

export type CheckoutErrorKind = "network" | "denied" | "payment";
export type CheckoutRetry = "start" | "prepare" | "refresh";

export type CheckoutPhase =
  | { name: Exclude<CheckoutPhaseName, "payment" | "error"> }
  | { name: "payment"; clientSecret: string }
  | { name: "error"; kind: CheckoutErrorKind; retry: CheckoutRetry };

/**
 * The phase implied by the authoritative purchase state:
 * - no purchase -> review (when the lead can still be seen) / unavailable;
 * - PENDING_PAYMENT -> `preparing` (resume: M140 is idempotent per purchase and returns the same attempt);
 * - CONFIRMED -> confirmed (the contact is then requested from M138 — which re-checks CONFIRMED itself);
 * - FAILED / CANCELLED -> their own terminal states (never silently resurrected);
 * - anything else (REFUNDED, REVOKED, or a status this UI does not know) -> unavailable. Fail safe.
 */
export function phaseFromPurchase(purchase: LeadPurchaseCheckoutDTO | null, leadAvailable: boolean): CheckoutPhase {
  if (!purchase) return { name: leadAvailable ? "review" : "unavailable" };
  switch (purchase.status) {
    case "PENDING_PAYMENT":
      return { name: "preparing" };
    case "CONFIRMED":
      return { name: "confirmed" };
    case "FAILED":
      return { name: "failed" };
    case "CANCELLED":
      return { name: "cancelled" };
    default:
      return { name: "unavailable" };
  }
}

/** Display-only: a backend decimal string in the backend currency. Never derived from another amount. */
export function formatBackendAmount(
  format: { number: (value: number, options: { style: "currency"; currency: string }) => string },
  amount: string,
  currency: string,
): string {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  try {
    return format.number(numeric, { style: "currency", currency });
  } catch {
    return `${amount} ${currency}`;
  }
}
