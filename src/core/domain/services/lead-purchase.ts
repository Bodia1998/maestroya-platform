import { DomainError } from "@/domain/errors/domain-error";
import type { LeadContactGrantState } from "@/domain/services/lead-contact-access-policy";

/**
 * Module 123 — Lead Marketplace: pure domain rules for `LeadPurchase`, a
 * professional's purchase of ACCESS to a Lead.
 *
 * `price` is the fee the professional pays MaestroYa for lead access. It is
 * NOT the customer's service price and NOT the professional's quote, and a
 * LeadPurchase is NOT a legacy Payment/Commission/Payout.
 *
 * Money follows the repository convention (a plain decimal amount with at
 * most 2 fraction digits, persisted as Decimal(10,2), plus an ISO currency
 * string — the same shape as Payment/Quote). No second Money abstraction.
 *
 * Status TRANSITIONS are deliberately NOT modelled here (Module 126+ owns
 * the payment state machine). Module 123 only represents the states.
 */
export const LEAD_PURCHASE_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "REVOKED",
] as const;
export type LeadPurchaseStatus = (typeof LEAD_PURCHASE_STATUSES)[number];

export const INITIAL_LEAD_PURCHASE_STATUS: LeadPurchaseStatus = "PENDING_PAYMENT";

/** Statuses that count as "in flight or paid". At most one such purchase may
 *  exist per (lead, professional) — mirrored by the partial unique index
 *  `lead_purchases_one_active_per_lead_professional` in the migration. Keep
 *  the two in sync (a contract test asserts it). */
export const ACTIVE_LEAD_PURCHASE_STATUSES = ["PENDING_PAYMENT", "CONFIRMED"] as const satisfies readonly LeadPurchaseStatus[];

export const LEAD_PURCHASE_CURRENCY = "EUR";
/** Decimal(10,2) upper bound. */
export const MAX_LEAD_PURCHASE_PRICE = 99_999_999.99;

export function isLeadPurchaseStatus(value: unknown): value is LeadPurchaseStatus {
  return typeof value === "string" && (LEAD_PURCHASE_STATUSES as readonly string[]).includes(value);
}

export function isActiveLeadPurchaseStatus(status: LeadPurchaseStatus): boolean {
  return (ACTIVE_LEAD_PURCHASE_STATUSES as readonly string[]).includes(status);
}

export class InvalidLeadPurchaseError extends DomainError {
  readonly code = "INVALID_LEAD_PURCHASE";

  constructor(message: string) {
    super(message);
  }
}

/** Thrown when the professional already has a PENDING_PAYMENT/CONFIRMED
 *  purchase for the lead. */
export class DuplicateActiveLeadPurchaseError extends DomainError {
  readonly code = "DUPLICATE_ACTIVE_LEAD_PURCHASE";

  constructor() {
    super("This professional already has an active purchase for this lead.");
  }
}

/** Price must be a finite, non-negative amount with at most 2 decimals and
 *  within Decimal(10,2); currency must be the project currency (EUR). */
export function assertValidLeadPurchaseAmount(price: number, currency: string): void {
  if (typeof price !== "number" || !Number.isFinite(price)) {
    throw new InvalidLeadPurchaseError("Lead purchase price must be a finite number.");
  }
  if (price < 0) throw new InvalidLeadPurchaseError("Lead purchase price must not be negative.");
  if (price > MAX_LEAD_PURCHASE_PRICE) throw new InvalidLeadPurchaseError("Lead purchase price exceeds the supported maximum.");
  const cents = price * 100;
  if (Math.abs(cents - Math.round(cents)) > 1e-6) {
    throw new InvalidLeadPurchaseError("Lead purchase price must have at most 2 decimal places.");
  }
  if (currency !== LEAD_PURCHASE_CURRENCY) {
    throw new InvalidLeadPurchaseError(`Lead purchase currency must be "${LEAD_PURCHASE_CURRENCY}".`);
  }
}

/**
 * A purchase is a *candidate* for contact authorization only when it is
 * CONFIRMED. This is NOT an access decision: contact access is decided
 * exclusively by Module 122's `canProfessionalAccessLeadContact`.
 * `PENDING_PAYMENT` (and every other status) never authorizes contact.
 */
export function isContactAuthorizationCandidate(status: LeadPurchaseStatus): boolean {
  return status === "CONFIRMED";
}

/**
 * Mapping contract for the future Module 122 `LeadContactAuthorizationReader`
 * adapter. Only CONFIRMED maps to "CONFIRMED"; unknown input maps to
 * "INVALID" (deny by default).
 */
export function toLeadContactGrantState(status: LeadPurchaseStatus | string): LeadContactGrantState {
  switch (status) {
    case "CONFIRMED":
      return "CONFIRMED";
    case "PENDING_PAYMENT":
      return "PENDING";
    case "REVOKED":
      return "REVOKED";
    default:
      // FAILED, CANCELLED, REFUNDED and anything unrecognised.
      return "INVALID";
  }
}
