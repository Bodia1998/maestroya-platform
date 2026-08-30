/**
 * Base error type for the domain layer.
 *
 * Use cases in the application layer catch and translate these into
 * whatever shape the delivery mechanism needs (an HTTP status code in a
 * Route Handler, a form error in a Server Action, etc.). The domain layer
 * itself never knows about HTTP, so it only ever throws these.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND";

  constructor(entity: string, id: string) {
    super(`${entity} with id "${id}" was not found.`);
  }
}

export class ValidationError extends DomainError {
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = "UNAUTHORIZED";

  constructor(message = "You are not authorized to perform this action.") {
    super(message);
  }
}

export class ConflictError extends DomainError {
  readonly code = "CONFLICT";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Security & Anti-Abuse module (Module 24): thrown when a caller has
 * exceeded a configured rate-limit policy (see
 * application/ports/rate-limit-policies.ts). `retryAfterMs` is safe to
 * surface to the client (how long to wait) — never expose the underlying
 * limit/window/current-count, which would help an attacker tune their
 * request rate to just under the threshold.
 */
export class RateLimitedError extends DomainError {
  readonly code = "RATE_LIMITED";
  readonly retryAfterMs: number;

  constructor(message = "Too many requests. Please try again later.", retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Security & Anti-Abuse module (Module 24): thrown when an authenticated
 * user is temporarily blocked by an active AccountRestriction (see
 * domain/repositories/account-restriction-repository.ts). The message is
 * deliberately generic — the internal reason category and expiry are
 * never surfaced to the restricted user, only ever to an admin via the
 * dedicated admin-only read path.
 */
export class AccountRestrictedError extends DomainError {
  readonly code = "ACCOUNT_RESTRICTED";

  constructor(message = "This action is temporarily unavailable for your account.") {
    super(message);
  }
}

/**
 * Module 35 — Payment Domain Model Preparation: thrown by the `Payment`
 * aggregate (`domain/entities/payment.ts`) when a caller requests a status
 * change its lifecycle does not allow from the current status — e.g.
 * capturing a payment that already `FAILED`, or refunding one that was
 * never `CAPTURED`. Raised from inside the aggregate itself (see
 * `Payment.transitionTo`/`Payment.refund`), not re-validated ad hoc at
 * every call site, so "invalid state changes are prevented" is a property
 * of `Payment` itself — true for today's application code and for the
 * Module 59 Stripe webhook handler that will call these same methods.
 */
export class InvalidPaymentTransitionError extends DomainError {
  readonly code = "INVALID_PAYMENT_TRANSITION";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 36 — Tax Engine Preparation: thrown by `domain/services/tax-*`
 * for any tax-calculation input that fails validation (e.g. a negative or
 * non-finite `taxableAmount`/`serviceAmount`/`materialsAmount`, or an
 * empty `countryCode`) that isn't more specifically an
 * `UnsupportedCountryError` or `InvalidTaxRateError`. Kept as its own
 * class (rather than reusing `ValidationError`) so tax-module failures are
 * distinguishable from generic application-layer input validation — see
 * `docs/MODULE_22_COMMISSION_FINANCIAL.md`'s "Module 26 (IVA/Tax)
 * boundary" for why this module's errors are kept separately addressable.
 */
export class TaxCalculationError extends DomainError {
  readonly code = "TAX_CALCULATION_ERROR";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 36 — Tax Engine Preparation: thrown by
 * `domain/services/tax-calculator.ts`'s `resolveTaxCalculator` when no
 * `TaxCalculator` is registered for a given (normalized) country code.
 * Deliberately never falls back to a default calculator — an unsupported
 * country must always be a caller-visible error, never a silently-wrong
 * tax rate.
 */
export class UnsupportedCountryError extends DomainError {
  readonly code = "UNSUPPORTED_COUNTRY";
  readonly countryCode: string;

  constructor(countryCode: string) {
    super(`No tax calculator registered for country code "${countryCode}".`);
    this.countryCode = countryCode;
  }
}

/**
 * Module 36 — Tax Engine Preparation: thrown by a `TaxCalculator`
 * implementation (e.g. `SpainIvaCalculator`) when a caller-supplied
 * `rateBps` isn't one of the rates that country actually recognizes.
 * Exposes `rateBps`/`validRatesBps` as structured fields (same convention
 * as `RateLimitedError.retryAfterMs`) so a caller can build a helpful
 * message without re-parsing this error's own text.
 */
export class InvalidTaxRateError extends DomainError {
  readonly code = "INVALID_TAX_RATE";
  readonly rateBps: number;
  readonly validRatesBps: readonly number[];

  constructor(rateBps: number, validRatesBps: readonly number[], countryCode: string) {
    super(
      `${rateBps} bps is not a valid tax rate for country code "${countryCode}". ` +
        `Valid rates (bps): ${validRatesBps.join(", ")}.`,
    );
    this.rateBps = rateBps;
    this.validRatesBps = validRatesBps;
  }
}

/**
 * Module 54 — Backup & Disaster Recovery: thrown by the `BackupRecord`
 * aggregate (`domain/entities/backup.ts`) when a caller requests a status
 * change its lifecycle does not allow from the current status — e.g.
 * marking an already-`COMPLETED` backup `RUNNING` again, or verifying one
 * that never completed. Mirrors `InvalidPaymentTransitionError` exactly:
 * raised from inside the aggregate itself, never re-validated ad hoc at
 * every call site.
 */
export class InvalidBackupTransitionError extends DomainError {
  readonly code = "INVALID_BACKUP_TRANSITION";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 54 — Backup & Disaster Recovery: thrown by
 * `BackupValidationService` when a completed backup's own metadata is
 * internally inconsistent (missing checksum, zero/negative size, a
 * location URI that doesn't match its declared target) — i.e. the backup
 * artifact itself cannot be trusted, before integrity or restore
 * questions even arise. Never thrown for a transient provider failure
 * (that is a plain rejected promise, handled by the calling use case),
 * only for "the data we were handed doesn't make sense."
 */
export class BackupValidationError extends DomainError {
  readonly code = "BACKUP_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 54 — Backup & Disaster Recovery: thrown by
 * `RestoreValidationService` when a specific `BackupRecord` is not a
 * legitimate restore candidate — not `COMPLETED`/`VERIFIED`, already
 * `EXPIRED`, or targeting a different system than the restore requested.
 * Kept distinct from `BackupValidationError` (which is about the backup
 * artifact's own internal consistency) so a caller can tell "this backup
 * is broken" apart from "this backup is fine but wrong for this restore."
 */
export class RestoreValidationError extends DomainError {
  readonly code = "RESTORE_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 54 — Backup & Disaster Recovery: thrown by
 * `IntegrityCheckService` when a backup artifact's recomputed checksum no
 * longer matches the checksum recorded at completion time — the artifact
 * has been corrupted, truncated, or tampered with since it was written.
 * Always a hard stop: a corrupted backup must never be offered as a
 * restore candidate.
 */
export class IntegrityCheckError extends DomainError {
  readonly code = "INTEGRITY_CHECK_ERROR";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 54 — Backup & Disaster Recovery: thrown when a caller references
 * a disaster-recovery plan id that isn't in the plan catalog
 * (`application/services/recovery/disaster-recovery-plans.ts`).
 */
export class RecoveryPlanNotFoundError extends NotFoundError {
  constructor(planId: string) {
    super("DisasterRecoveryPlan", planId);
  }
}

/**
 * Module 54 — Backup & Disaster Recovery: thrown by the `RecoveryExecution`
 * aggregate (`domain/entities/disaster-recovery.ts`) for a lifecycle
 * transition its current status does not allow — e.g. recording a
 * checkpoint against an execution that already `COMPLETED`, or completing
 * one that was never started. Same reasoning as
 * `InvalidBackupTransitionError`.
 */
export class InvalidRecoveryTransitionError extends DomainError {
  readonly code = "INVALID_RECOVERY_TRANSITION";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 57 — Load Testing & Capacity Planning: thrown by the
 * `LoadTestResult` aggregate (`domain/entities/load-test-result.ts`) for a
 * lifecycle transition its current status does not allow — e.g. completing
 * a run that never started, or completing one already `COMPLETED`. Same
 * reasoning as `InvalidBackupTransitionError`/`InvalidRecoveryTransitionError`:
 * raised from inside the aggregate itself, never re-validated ad hoc at
 * every call site.
 */
export class InvalidLoadTestTransitionError extends DomainError {
  readonly code = "INVALID_LOAD_TEST_TRANSITION";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 57 — Load Testing & Capacity Planning: thrown by the
 * `WorkloadProfile`/`PerformanceScenario` value objects
 * (`domain/entities/performance-scenario.ts`) when constructed with an
 * invalid shape (non-positive virtual-user count, a ramp-up longer than
 * the run itself, an empty scenario id, etc). Kept as its own class,
 * rather than a bare `RangeError`, so `ExecuteLoadTestUseCase` and its
 * callers can distinguish "the requested workload itself is malformed"
 * from any other domain failure without string-matching a message — the
 * same reasoning `InvalidTaxRateError` is kept distinguishable from a
 * generic `ValidationError`.
 */
export class InvalidWorkloadProfileError extends DomainError {
  readonly code = "INVALID_WORKLOAD_PROFILE";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 59 — Professional Verification (Persona): thrown by a
 * `VerificationProvider` implementation (application/ports/
 * verification-provider.ts) when the external KYC provider itself fails —
 * a non-2xx response, a timeout, an unparseable payload, or an invalid
 * webhook signature. This is the one error shape every use case that
 * depends on the port needs to know about; provider-specific detail
 * (Persona's own error codes, HTTP status, etc.) is preserved on
 * `cause`/`retryable` but never leaks a provider SDK type into the
 * application or domain layers — same reasoning `PaymentGateway`'s own
 * doc comment gives for keeping Stripe out of the domain entirely.
 * `retryable` distinguishes a transient failure (timeout, 5xx, network
 * error — safe to retry with backoff) from a permanent one (4xx other
 * than 429, malformed webhook signature) so a caller doesn't have to
 * string-match `message` to decide whether to retry.
 */
export class VerificationProviderError extends DomainError {
  readonly code = "VERIFICATION_PROVIDER_ERROR";
  readonly provider: string;
  readonly retryable: boolean;

  constructor(provider: string, message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(`[${provider}] ${message}`);
    this.provider = provider;
    this.retryable = retryable;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Module 60 — Referral & Marketing Attribution Platform: thrown by
 * `domain/services/referral-code-rules.ts`'s `assertValidReferralCode` when
 * a candidate referral code violates its format rules (length outside
 * 3–40 characters, or characters other than lowercase letters/digits/
 * underscore). Kept as its own class — rather than reusing the generic
 * `ValidationError` — so `CreateReferralCodeUseCase`/`TrackVisitUseCase`
 * callers can distinguish "this referral code is malformed" from any other
 * application-layer input-validation failure without string-matching a
 * message, the same reasoning `InvalidTaxRateError`/`InvalidWorkloadProfileError`
 * give for their own dedicated error classes.
 */
export class ReferralCodeError extends DomainError {
  readonly code = "REFERRAL_CODE_ERROR";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 61 — Affiliate & Partner System: thrown by
 * `domain/services/partner-approval-rules.ts`'s
 * `assertValidPartnerStatusTransition` when a caller (an admin
 * approve/reject/suspend/ban use case) requests a `Partner.status` change
 * its lifecycle does not allow from the current status — e.g. approving an
 * already-`BANNED` partner, or suspending one still `PENDING`. Same
 * reasoning as `InvalidPaymentTransitionError`/`InvalidBackupTransitionError`:
 * raised from inside the pure state-machine check itself, never
 * re-validated ad hoc at every call site.
 */
export class InvalidPartnerTransitionError extends DomainError {
  readonly code = "INVALID_PARTNER_TRANSITION";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 61 — Affiliate & Partner System: thrown when a use case that
 * requires an `APPROVED` partner (generating a referral link, recording an
 * affiliate commission, requesting a payout) is called for a partner whose
 * status is `PENDING`, `REJECTED`, `SUSPENDED`, or `BANNED` — see
 * `domain/services/partner-approval-rules.ts`'s
 * `isPartnerActiveForAffiliateActivity`. Kept distinct from the generic
 * `UnauthorizedError` so callers can tell "this partner isn't approved yet"
 * apart from "this caller has no permission to act on this partner at
 * all."
 */
export class PartnerNotActiveError extends DomainError {
  readonly code = "PARTNER_NOT_ACTIVE";

  constructor(status: string) {
    super(`This partner is not eligible for affiliate activity while status is "${status}".`);
  }
}

/**
 * Module 63 — Materials Procurement Workflow: thrown by
 * `domain/services/materials-procurement-rules.ts`'s
 * `assertValidMaterialsList` when a Quote's `materialsStrategy` is
 * `CUSTOMER_PURCHASED` but the professional submitted an empty (or
 * invalid) required-materials list. A `CUSTOMER_PURCHASED` quote without a
 * checklist would leave the customer with no idea what to buy, so this is
 * always a hard validation failure — never silently coerced to
 * `PROFESSIONAL_SUPPLIED`. Kept as its own class (rather than the generic
 * `ValidationError`) so `CreateQuoteUseCase`/`UpdateQuoteUseCase` callers
 * can distinguish "the materials list itself is the problem" the same way
 * `ReferralCodeError`/`InvalidTaxRateError` are kept distinguishable from
 * a generic input-validation failure.
 */
export class MaterialsListRequiredError extends DomainError {
  readonly code = "MATERIALS_LIST_REQUIRED";

  constructor(message = "A materials list is required when the customer purchases the materials.") {
    super(message);
  }
}

/**
 * Module 78 — IVA / Tax Integration audit finding (materials-strategy
 * gap): thrown by `materials-procurement-rules.ts`'s
 * `assertNoPricedMaterialsWhenCustomerPurchased`, called from
 * `CreateQuoteUseCase`/`UpdateQuoteUseCase`, when a Quote whose
 * `materialsStrategy` is `CUSTOMER_PURCHASED` carries a priced (`unitPrice
 * > 0`) `MATERIALS`-category `QuoteItem`. Before this check existed,
 * nothing prevented that combination, and Module 64's commission engine
 * (which reads only `QuoteItem.category`, never `materialsStrategy`) would
 * silently commission materials MaestroYa never charges for. Kept as its
 * own class (rather than the generic `ValidationError`) for the same
 * reason `MaterialsListRequiredError` is — a caller can distinguish "a
 * priced materials item isn't allowed here" from a generic input error.
 */
export class PricedMaterialsNotAllowedError extends DomainError {
  readonly code = "PRICED_MATERIALS_NOT_ALLOWED";

  constructor(
    message = "A priced materials item is not allowed when the customer purchases the materials directly.",
  ) {
    super(message);
  }
}

/**
 * Module 63 — Materials Procurement Workflow: thrown by `StartJobUseCase`
 * when a Job's accepted Quote has `materialsStrategy` `CUSTOMER_PURCHASED`
 * and the customer has not yet confirmed (`Quote.materialsConfirmedAt` is
 * still null) that every required material has been purchased. Implements
 * the module's core business rule — "the booking cannot begin until the
 * customer confirms that all required materials have been purchased" —
 * as a hard stop enforced server-side in the use case itself (see
 * `domain/services/materials-procurement-rules.ts`'s
 * `canStartJobGivenMaterials`), never assumed from client-side UI state
 * alone.
 */
export class MaterialsNotConfirmedError extends DomainError {
  readonly code = "MATERIALS_NOT_CONFIRMED";

  constructor(message = "Materials must be purchased and confirmed before the scheduled work can begin.") {
    super(message);
  }
}

/**
 * Module 65 — Trust & Integrity System: thrown when a `TrustProfile` is
 * looked up (e.g. by `GetUserTrustProfileUseCase`) for a userId that has
 * never had one created. In practice this should be rare —
 * `RecordUserBehaviorSignalUseCase` lazily creates a `TrustProfile` on
 * first use for any user — but every read path still asserts explicitly
 * rather than silently defaulting, so a caller can tell "this user
 * genuinely has no trust profile yet" apart from "the profile legitimately
 * has default score 70/0."
 */
export class TrustProfileNotFoundError extends DomainError {
  readonly code = "TRUST_PROFILE_NOT_FOUND";

  constructor(userId: string) {
    super(`No TrustProfile exists for user "${userId}".`);
  }
}

/**
 * Module 65 — Trust & Integrity System: thrown by
 * `domain/entities/manual-review-case.ts`'s `assertValidManualReviewTransition`
 * when a requested state transition is not in `ManualReviewCase`'s allowed
 * transition table (e.g. attempting to move a `RESOLVED` case back to
 * `UNDER_REVIEW`).
 */
export class InvalidManualReviewTransitionError extends DomainError {
  readonly code = "INVALID_MANUAL_REVIEW_TRANSITION";

  constructor(from: string, to: string) {
    super(`Cannot transition a manual review case from "${from}" to "${to}".`);
  }
}

/**
 * Module 65 — Trust & Integrity System: thrown by
 * `domain/entities/appeal.ts`'s `assertValidAppealTransition` for the same
 * reason `InvalidManualReviewTransitionError` exists, applied to the
 * `TrustAppeal` state machine.
 */
export class InvalidAppealTransitionError extends DomainError {
  readonly code = "INVALID_APPEAL_TRANSITION";

  constructor(from: string, to: string) {
    super(`Cannot transition an appeal from "${from}" to "${to}".`);
  }
}

/**
 * Module 65 — Trust & Integrity System: thrown when
 * `SubmitAppealUseCase`/`ReviewAppealUseCase` cannot find the
 * `TrustAppeal` or `TrustAutomatedAction` a caller referenced by id.
 */
export class TrustAppealNotFoundError extends DomainError {
  readonly code = "TRUST_APPEAL_NOT_FOUND";

  constructor(id: string) {
    super(`No TrustAppeal exists with id "${id}".`);
  }
}

export class TrustAutomatedActionNotFoundError extends DomainError {
  readonly code = "TRUST_AUTOMATED_ACTION_NOT_FOUND";

  constructor(id: string) {
    super(`No TrustAutomatedAction exists with id "${id}".`);
  }
}

export class ManualReviewCaseNotFoundError extends DomainError {
  readonly code = "MANUAL_REVIEW_CASE_NOT_FOUND";

  constructor(id: string) {
    super(`No ManualReviewCase exists with id "${id}".`);
  }
}

/**
 * Module 65 — Trust & Integrity System: thrown by `SubmitAppealUseCase`
 * when the user already has a non-terminal appeal open against the same
 * `TrustAutomatedAction` — one live appeal per action at a time, the same
 * "no duplicate open workflow" rule `PartnerFraudFlagRepository`'s own
 * open-flag convention implies for a partner, applied here per action
 * rather than per user.
 */
export class DuplicateAppealError extends DomainError {
  readonly code = "DUPLICATE_APPEAL";

  constructor(automatedActionId: string) {
    super(`An appeal is already open against action "${automatedActionId}".`);
  }
}

/**
 * Module 71 — Stripe Connect: the closed set of failure categories a
 * `StripeConnectGateway` implementation (`infrastructure/payments/stripe/
 * stripe-connect-gateway.ts`) maps every Stripe SDK error onto before it
 * is allowed to cross into application code — mirrors
 * `VerificationProviderError`'s own "provider SDK error MUST NOT leak
 * past the adapter" rule, applied to Stripe Connect instead of Persona.
 * `AUTHENTICATION`/`INVALID_REQUEST` are permanent configuration/input
 * problems; `NOT_FOUND` is a stale/deleted connected account id;
 * `ACCOUNT_RESTRICTED` is a Stripe-side capability/permission denial
 * (e.g. acting on an account this platform no longer controls);
 * `RATE_LIMITED`/`NETWORK`/`TEMPORARY` are transient and safe to retry;
 * `UNKNOWN` is anything the adapter did not recognize.
 */
export type StripeConnectErrorCategory =
  | "AUTHENTICATION"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "ACCOUNT_RESTRICTED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "TEMPORARY"
  | "UNKNOWN";

/**
 * Module 71 — Stripe Connect: thrown by `StripeConnectGatewayAdapter`
 * (`infrastructure/payments/stripe/stripe-connect-gateway.ts`) for any
 * failed Stripe API call — connected account creation, onboarding/login
 * link generation, or account status retrieval. This is the one error
 * shape every Stripe Connect use case needs to know about; the raw
 * Stripe SDK error (its own error class, HTTP status, request id) is
 * preserved on `cause` but never leaks a Stripe SDK type into the
 * application or domain layers — same reasoning `VerificationProviderError`
 * gives for keeping Persona out of the domain entirely. `retryable`
 * distinguishes a transient failure (rate limit, network, Stripe-side
 * 5xx — safe to retry with backoff) from a permanent one (bad request,
 * missing resource, restricted account) so a caller doesn't have to
 * string-match `message` to decide whether to retry.
 */
export class StripeConnectError extends DomainError {
  readonly code = "STRIPE_CONNECT_ERROR";
  readonly category: StripeConnectErrorCategory;
  readonly retryable: boolean;

  constructor(category: StripeConnectErrorCategory, message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(`[stripe_connect:${category}] ${message}`);
    this.category = category;
    this.retryable = retryable;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Module 73 — Real Customer Payment Capture: thrown by
 * `StripePaymentGatewayAdapter` (`infrastructure/payments/stripe/
 * stripe-payment-gateway.ts`) for any failed Stripe API call made on
 * behalf of a customer payment (PaymentIntent create/capture/cancel).
 * Mirrors `StripeConnectError` exactly — same category vocabulary, same
 * "raw Stripe SDK error preserved on `cause`, never leaked into the
 * application/domain layers" contract, same `retryable` signal — kept as
 * its own class (not a reuse of `StripeConnectError`) because the two
 * adapters guard genuinely different Stripe resources (Connect account
 * management vs. PaymentIntents) and a caller catching one must never
 * accidentally also catch the other. `CARD_DECLINED` is the one category
 * `StripeConnectError` has no equivalent for — a card-processing-specific
 * failure (Stripe's own `card_error` type) that is never retryable with
 * the same request and must surface as "try a different payment method,"
 * not as a generic invalid-request error. `NOT_IMPLEMENTED` is used only
 * by `StripePaymentGatewayAdapter.refund` — see that method's own doc
 * comment on why a real refund flow is deliberately out of Module 73's
 * scope.
 */
export type PaymentGatewayErrorCategory =
  | "AUTHENTICATION"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "CARD_DECLINED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "TEMPORARY"
  | "NOT_IMPLEMENTED"
  | "UNKNOWN";

export class PaymentGatewayError extends DomainError {
  readonly code = "PAYMENT_GATEWAY_ERROR";
  readonly category: PaymentGatewayErrorCategory;
  readonly retryable: boolean;

  constructor(category: PaymentGatewayErrorCategory, message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(`[payment_gateway:${category}] ${message}`);
    this.category = category;
    this.retryable = retryable;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
/**
 * Module 76 — Professional Payout Execution: the closed set of failure
 * categories a `StripeTransferGateway` implementation
 * (`infrastructure/payments/stripe/stripe-transfer-gateway.ts`) maps every
 * Stripe SDK error onto before it is allowed to cross into application
 * code — mirrors `StripeConnectError`/`PaymentGatewayError`'s own
 * "provider SDK error MUST NOT leak past the adapter" contract, applied to
 * `stripe.transfers.create` instead of Connect account management or
 * PaymentIntents. `INSUFFICIENT_BALANCE` and `INVALID_DESTINATION` are the
 * two failure modes a Transfer specifically introduces that neither sibling
 * error type has an equivalent for: the platform's own Stripe balance
 * cannot cover the transfer amount (Stripe's `balance_insufficient` code),
 * and the destination connected account cannot currently receive transfers
 * (a restricted/incomplete/deauthorized account — Stripe's
 * `resource_missing`/`account_invalid`/permission-denied family). Both are
 * permanent for the *same* request (retrying identically will fail
 * identically) but may become retryable later once the underlying
 * condition changes — see `ExecuteProfessionalPayoutUseCase`'s own
 * "retryable vs. permanent" handling, which treats both as
 * `retryable: false` for the immediate retry decision while still leaving
 * the `Payout` row `FAILED` (not `CANCELLED`) so a later manual retry, once
 * balance/destination is fixed, is still possible.
 */
export type StripeTransferErrorCategory =
  | "AUTHENTICATION"
  | "INVALID_REQUEST"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_DESTINATION"
  | "ACCOUNT_RESTRICTED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "TEMPORARY"
  | "UNKNOWN";

/**
 * Module 76 — Professional Payout Execution: thrown by
 * `StripeTransferGatewayAdapter`
 * (`infrastructure/payments/stripe/stripe-transfer-gateway.ts`) for any
 * failed `stripe.transfers.create` call. This is the one error shape
 * `ExecuteProfessionalPayoutUseCase` needs to know about; the raw Stripe
 * SDK error (its own error class, HTTP status, request id) is preserved on
 * `cause` but never leaks a Stripe SDK type into the application or domain
 * layers — same reasoning `StripeConnectError`/`PaymentGatewayError` give
 * for keeping Stripe out of the domain entirely. `retryable` distinguishes
 * a transient failure (rate limit, network, Stripe-side 5xx — safe to
 * retry with backoff, possibly automatically) from a permanent one
 * (invalid request, insufficient balance, invalid/restricted destination —
 * requires a human or an external state change before a retry could ever
 * succeed) so a caller doesn't have to string-match `message` to decide
 * whether to retry.
 */
export class StripeTransferError extends DomainError {
  readonly code = "STRIPE_TRANSFER_ERROR";
  readonly category: StripeTransferErrorCategory;
  readonly retryable: boolean;

  constructor(category: StripeTransferErrorCategory, message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(`[stripe_transfer:${category}] ${message}`);
    this.category = category;
    this.retryable = retryable;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Module 79 — Invoicing & Credit Notes: thrown whenever a caller requests
 * an `Invoice`/`CreditNote` lifecycle transition its current status does
 * not allow (e.g. issuing a `DRAFT` invoice directly, accepting an
 * already-`ISSUED` invoice, editing an `ISSUED` invoice's line items).
 * Mirrors `InvalidPaymentTransitionError`/`InvalidBackupTransitionError`
 * exactly: the state machine lives in `domain/services/invoice-lifecycle.ts`
 * / `credit-note-lifecycle.ts`, this error is simply what it throws — no
 * use case or controller re-implements its own status check.
 */
export class InvalidInvoiceTransitionError extends DomainError {
  readonly code = "INVALID_INVOICE_TRANSITION";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 79 — Invoicing & Credit Notes: thrown when an invoicing operation
 * requires the professional/company to have an active self-billing
 * authorization (see `domain/repositories/self-billing-authorization-repository.ts`)
 * and none exists, or the existing one has been revoked. Deliberately
 * distinct from `UnauthorizedError` (an authentication/session concept) —
 * this is a business precondition ("has this party agreed to self-billing
 * at all"), not an access-control failure.
 */
export class SelfBillingNotAuthorizedError extends DomainError {
  readonly code = "SELF_BILLING_NOT_AUTHORIZED";

  constructor(message = "This professional has not authorized MaestroYa's self-billing process.") {
    super(message);
  }
}

/**
 * Module 79 — Invoicing & Credit Notes: thrown by
 * `domain/services/credit-note-eligibility.ts` when a requested credit
 * note amount would exceed the original invoice's remaining creditable
 * amount (invoice total minus every already-issued credit note against
 * it), or when the target invoice is not in a creditable status
 * (`ISSUED`/`PAID`).
 */
export class CreditNoteExceedsRemainingAmountError extends DomainError {
  readonly code = "CREDIT_NOTE_EXCEEDS_REMAINING_AMOUNT";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Module 83 — Professional Verification Enforcement: thrown by
 * `CreateQuoteUseCase` (and any other operational-eligibility gate that
 * follows the same rule) when the acting professional's
 * `ProfessionalProfile.verificationStatus` is not `"VERIFIED"` — i.e. they
 * have never submitted verification, are still under review, or were
 * rejected. Deliberately distinct from the generic `ValidationError` this
 * module used to throw for "no active profile" so callers/UI can
 * distinguish "you have no profile" from "your profile exists but isn't
 * verified yet" without parsing message text.
 */
export class ProfessionalNotVerifiedError extends DomainError {
  readonly code = "PROFESSIONAL_NOT_VERIFIED";

  constructor(message = "Your professional profile must be verified before you can do this.") {
    super(message);
  }
}

/**
 * Module 83 — Professional Verification Enforcement: thrown by
 * `ApproveProfessionalVerificationUseCase` when an admin attempts to
 * approve a solo professional's identity-verification case whose document
 * set does not include a business-registration document (see
 * `hasBusinessRegistrationDocument`/`BUSINESS_REGISTRATION_DOCUMENT_TYPES`
 * in `professional-verification-rules.ts`, already introduced by Module
 * 74). Proof of identity alone is not sufficient for a solo professional
 * to become operational — the platform's business rule also requires
 * proof of professional/business registration (autónomo or equivalent),
 * mirroring the stronger requirement `company-verification-rules.ts`
 * already enforces at company-verification submission time. An admin
 * hitting this error should reject the case or request resubmission
 * (both already-existing actions) asking the professional to add the
 * missing document — this error does not itself mutate anything.
 */
export class BusinessRegistrationRequiredError extends DomainError {
  readonly code = "BUSINESS_REGISTRATION_REQUIRED";

  constructor(
    message = "This professional's verification case is missing a business-registration document and cannot be approved yet.",
  ) {
    super(message);
  }
}
