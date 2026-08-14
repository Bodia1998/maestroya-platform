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
