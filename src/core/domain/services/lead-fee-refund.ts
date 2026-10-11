import { DomainError, type PaymentGatewayErrorCategory } from "@/domain/errors/domain-error";

/**
 * Module 153 — Lead-Fee Refund Execution: pure domain rules (no I/O, no provider SDK).
 *
 * A refund is a FULL (100%) return of the amount a professional actually paid MaestroYa for a CONFIRMED lead purchase
 * (PLATFORM_ERROR) or of an EXTRA duplicate payment for the same purchase (DUPLICATE_CHARGE). Money is never computed
 * here: the amount is the persisted purchase snapshot total, which the provider-confirmed charge must equal exactly.
 * Only administrators may start one, and only while the real-refund switch is explicitly enabled.
 */

export const LEAD_FEE_REFUND_REASON_CODES = ["PLATFORM_ERROR", "DUPLICATE_CHARGE"] as const;
export type LeadFeeRefundReasonCode = (typeof LEAD_FEE_REFUND_REASON_CODES)[number];

export const LEAD_FEE_REFUND_STATUSES = ["REQUESTED", "PROVIDER_PENDING", "UNKNOWN", "SUCCEEDED", "FAILED"] as const;
export type LeadFeeRefundStatus = (typeof LEAD_FEE_REFUND_STATUSES)[number];

/** The outcome at the provider is not (yet) settled: such an attempt blocks every new attempt for the same payment. */
export const LEAD_FEE_REFUND_UNRESOLVED_STATUSES = ["REQUESTED", "PROVIDER_PENDING", "UNKNOWN"] as const satisfies readonly LeadFeeRefundStatus[];
/** Mirrors the partial unique index in the migration: at most one attempt per payment in these statuses. */
export const LEAD_FEE_REFUND_ACTIVE_STATUSES = ["REQUESTED", "PROVIDER_PENDING", "UNKNOWN", "SUCCEEDED"] as const satisfies readonly LeadFeeRefundStatus[];

export function isUnresolvedLeadFeeRefundStatus(status: LeadFeeRefundStatus): boolean {
  return (LEAD_FEE_REFUND_UNRESOLVED_STATUSES as readonly string[]).includes(status);
}

/** Mirrors the DB trigger `lead_fee_refunds_guard_update`. SUCCEEDED and FAILED are terminal. */
export const LEAD_FEE_REFUND_TRANSITIONS: Readonly<Record<LeadFeeRefundStatus, readonly LeadFeeRefundStatus[]>> = {
  REQUESTED: ["PROVIDER_PENDING", "UNKNOWN", "SUCCEEDED", "FAILED"],
  PROVIDER_PENDING: ["SUCCEEDED", "FAILED"],
  UNKNOWN: ["PROVIDER_PENDING", "SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export function canTransitionLeadFeeRefund(from: LeadFeeRefundStatus, to: LeadFeeRefundStatus): boolean {
  return LEAD_FEE_REFUND_TRANSITIONS[from].includes(to);
}

/**
 * Roles allowed to execute a refund. Deliberately a LOCAL constant (the application layer must not import the
 * infrastructure RBAC table); a unit test pins it to the real `ROLES` values so drift fails the build.
 */
export const LEAD_FEE_REFUND_ALLOWED_ACTOR_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
export const LEAD_FEE_REFUND_ACTOR_ACTIVE_STATUS = "ACTIVE";

export const LEAD_FEE_REFUND_CURRENCY = "EUR";
export const LEAD_FEE_REFUND_EXPLANATION_MAX_LENGTH = 1000;
export const LEAD_FEE_REFUND_EVIDENCE_MAX_LENGTH = 200;

export type LeadFeeRefundRejection =
  | "INVALID_INPUT"
  | "SWITCH_DISABLED"
  | "CONFIG_INVALID"
  | "ACTOR_NOT_AUTHORIZED"
  | "PURCHASE_NOT_FOUND"
  | "PURCHASE_NOT_CONFIRMED"
  | "SNAPSHOT_INVALID"
  | "PAYMENT_REFERENCE_MISSING"
  | "DUPLICATE_REFERENCE_REQUIRED"
  | "DUPLICATE_REFERENCE_SAME_AS_PURCHASE"
  | "DUPLICATE_REFERENCE_CONFLICT"
  | "REASON_MISMATCH"
  | "PAYMENT_NOT_SUCCEEDED"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "PAYMENT_NOT_ASSOCIATED"
  | "PAYMENT_DISPUTED"
  | "ALREADY_REFUNDED"
  | "PROVIDER_STATE_UNVERIFIABLE"
  | "ATTEMPT_IN_PROGRESS";

/** Operator-facing (admin only) rejection; `reason` is a closed code, the message never carries provider detail or personal data. */
export class LeadFeeRefundRejectedError extends DomainError {
  readonly code = "LEAD_FEE_REFUND_REJECTED";

  constructor(readonly reason: LeadFeeRefundRejection) {
    super(`Lead-fee refund rejected: ${reason}.`);
  }
}

// ---------------------------------------------------------------- switches (config only; no trigger exists)

export const LEAD_FEE_REFUND_ENV = {
  /** Master switch: real-money refunds. Anything but the exact string "true" keeps it OFF; other non-empty values are INVALID. */
  realRefundsEnabled: "LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED",
  /** Separate switch for automatic technical refunds. Requires the master switch. No automatic trigger exists in M153. */
  automaticTechnicalRefundsEnabled: "LEAD_FEE_REFUND_AUTOMATIC_TECHNICAL_ENABLED",
} as const;

export type LeadFeeRefundConfig =
  | { status: "VALID"; realRefundsEnabled: boolean; automaticTechnicalRefundsEnabled: boolean }
  | { status: "INVALID" };

/** Fail-closed: unset/empty/"false" = OFF; "true" = ON; anything else, or automatic ON without master ON, = INVALID (blocks). */
export function resolveLeadFeeRefundConfig(env: Readonly<Record<string, string | undefined>>): LeadFeeRefundConfig {
  const master = parseSwitch(env[LEAD_FEE_REFUND_ENV.realRefundsEnabled]);
  const automatic = parseSwitch(env[LEAD_FEE_REFUND_ENV.automaticTechnicalRefundsEnabled]);
  if (master === "INVALID" || automatic === "INVALID") return { status: "INVALID" };
  if (automatic && !master) return { status: "INVALID" };
  return { status: "VALID", realRefundsEnabled: master, automaticTechnicalRefundsEnabled: automatic };
}

function parseSwitch(raw: string | undefined): boolean | "INVALID" {
  if (raw === undefined) return false;
  const value = raw.trim();
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  return "INVALID";
}

/** The only enforcement of the automatic switch: nothing in M153 triggers automatically, a future trigger must ask this first. */
export function isAutomaticTechnicalRefundAllowed(config: LeadFeeRefundConfig): boolean {
  return config.status === "VALID" && config.realRefundsEnabled && config.automaticTechnicalRefundsEnabled;
}

// ---------------------------------------------------------------- input rules

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/i;
const PHONE_LIKE = /(?:\+?\d[\s().-]?){9,}/;
const EVIDENCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/;
const PROVIDER_REFERENCE = /^[A-Za-z0-9_]{3,100}$/;

/**
 * Trims (never truncates) and validates the mandatory explanation: 1..1000 characters after trim. Obvious personal data
 * (email address, phone-like digit run, URL) is rejected. This is a HEURISTIC, not a guarantee that no personal data is present.
 */
export function normalizeLeadFeeRefundExplanation(raw: unknown): string {
  if (typeof raw !== "string") throw new LeadFeeRefundRejectedError("INVALID_INPUT");
  const text = raw.trim();
  if (text.length < 1 || text.length > LEAD_FEE_REFUND_EXPLANATION_MAX_LENGTH) throw new LeadFeeRefundRejectedError("INVALID_INPUT");
  if (EMAIL.test(text) || URL_LIKE.test(text) || PHONE_LIKE.test(text)) throw new LeadFeeRefundRejectedError("INVALID_INPUT");
  return text;
}

/** The incident / evidence reference is an opaque id (ticket id etc.), separate from the explanation. */
export function normalizeLeadFeeRefundEvidenceReference(raw: unknown): string {
  if (typeof raw !== "string") throw new LeadFeeRefundRejectedError("INVALID_INPUT");
  const text = raw.trim();
  if (text.length < 1 || text.length > LEAD_FEE_REFUND_EVIDENCE_MAX_LENGTH || !EVIDENCE_REFERENCE.test(text)) {
    throw new LeadFeeRefundRejectedError("INVALID_INPUT");
  }
  return text;
}

export function normalizeLeadFeeRefundProviderReference(raw: unknown): string {
  if (typeof raw !== "string") throw new LeadFeeRefundRejectedError("INVALID_INPUT");
  const text = raw.trim();
  if (!PROVIDER_REFERENCE.test(text)) throw new LeadFeeRefundRejectedError("INVALID_INPUT");
  return text;
}

export function isLeadFeeRefundReasonCode(value: unknown): value is LeadFeeRefundReasonCode {
  return typeof value === "string" && (LEAD_FEE_REFUND_REASON_CODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------- provider facts

/** Deterministic per (payment, attempt). A retry uses the next attempt number, hence a NEW key; an old key is never reused. */
export function leadFeeRefundIdempotencyKey(paymentReference: string, attemptNumber: number): string {
  return `lead-fee-refund:${paymentReference}:${attemptNumber}`;
}

/** What the provider says about a payment, reduced to what the refund rules need. */
export interface LeadFeeRefundablePaymentFacts {
  succeeded: boolean;
  amountMinorUnits: number;
  amountReceivedMinorUnits: number;
  amountRefundedMinorUnits: number;
  refunded: boolean;
  disputed: boolean;
  currency: string;
  /** The purchase id the payment was created for (provider metadata); null when absent. */
  purchaseId: string | null;
}

/**
 * Throws a LeadFeeRefundRejectedError unless the provider-confirmed payment is fully refundable for exactly this
 * purchase: succeeded, charged amount == snapshot total, EUR, created for this purchase, undisputed, and with NO refund
 * (partially refunded payments are never eligible for another full refund).
 */
export function assertLeadFeeRefundablePayment(
  payment: LeadFeeRefundablePaymentFacts,
  expected: { purchaseId: string; totalMinorUnits: number; currency: string },
): void {
  if (!payment.succeeded) throw new LeadFeeRefundRejectedError("PAYMENT_NOT_SUCCEEDED");
  if (payment.currency !== expected.currency || expected.currency !== LEAD_FEE_REFUND_CURRENCY) throw new LeadFeeRefundRejectedError("CURRENCY_MISMATCH");
  if (payment.amountMinorUnits !== expected.totalMinorUnits || payment.amountReceivedMinorUnits !== expected.totalMinorUnits) {
    throw new LeadFeeRefundRejectedError("AMOUNT_MISMATCH");
  }
  if (payment.purchaseId !== expected.purchaseId) throw new LeadFeeRefundRejectedError("PAYMENT_NOT_ASSOCIATED");
  if (payment.disputed) throw new LeadFeeRefundRejectedError("PAYMENT_DISPUTED");
  if (payment.refunded || payment.amountRefundedMinorUnits !== 0) throw new LeadFeeRefundRejectedError("ALREADY_REFUNDED");
}

/**
 * Provider error categories that DEFINITIVELY mean "the provider rejected the request and created no refund".
 * Everything else (timeouts, network, 5xx, rate limiting, idempotency conflicts, unknown) leaves the outcome UNKNOWN —
 * a failure is never inferred from a timeout or a local exception.
 */
const DEFINITIVE_REJECTION_CATEGORIES: readonly PaymentGatewayErrorCategory[] = ["INVALID_REQUEST", "AUTHENTICATION", "NOT_FOUND"];

export function isDefinitiveLeadFeeRefundRejection(category: PaymentGatewayErrorCategory): boolean {
  return DEFINITIVE_REJECTION_CATEGORIES.includes(category);
}
