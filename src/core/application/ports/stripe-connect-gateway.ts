/**
 * Module 71 — Stripe Connect.
 *
 * The single abstraction application code is allowed to depend on for
 * talking to Stripe Connect. No Stripe SDK type (`Stripe.Account`,
 * `Stripe.AccountLink`, `Stripe.LoginLink`, ...) appears here or anywhere
 * it's called from — the exact same "provider MUST NOT appear anywhere
 * in this module" rule `PaymentGateway`'s
 * (`application/ports/payment-gateway.ts`) and `VerificationProvider`'s
 * (`application/ports/verification-provider.ts`) own doc comments
 * document, applied to Connect account management instead of payments or
 * KYC.
 *
 * Scope: this port only covers *connected-account lifecycle* (create,
 * onboard, check status, dashboard access) — Module 71's objective.
 * Charging a customer and transferring the professional's share is a
 * separate future concern for `PaymentGateway`
 * (`application/ports/payment-gateway.ts`), once Module 72/73 build the
 * actual payment execution flow on top of the accounts this port creates
 * — see docs/MODULE_71_STRIPE_CONNECT.md's "Payment flow" section for why
 * that stays a `PaymentGateway`-level concern (separate charges +
 * transfers) rather than something this port grows into.
 *
 * `StripeConnectGatewayAdapter`
 * (`infrastructure/payments/stripe/stripe-connect-gateway.ts`) is the one
 * real implementation, wired from `infrastructure/payments/stripe/
 * compose.ts`. Every method throws `StripeConnectError`
 * (`domain/errors/domain-error.ts`) — never a raw Stripe SDK error — on
 * failure, the same provider-agnostic failure contract
 * `VerificationProvider` establishes for Persona.
 */
export interface CreateConnectedAccountRequest {
  /** The `ProfessionalProfile.id` this account belongs to — passed only
   *  to derive a deterministic Stripe idempotency key
   *  (`connect-account:<id>`), never sent to Stripe as account metadata
   *  containing internal identifiers beyond what onboarding already
   *  requires. */
  professionalProfileId: string;
  /** Pre-fills Stripe's hosted onboarding form; `null` skips pre-fill
   *  (Stripe collects it directly instead). Never required — this
   *  platform never blocks account creation on having an email on file. */
  email: string | null;
  /** ISO 3166-1 alpha-2 country code the connected account is registered
   *  in. MaestroYa currently operates in Spain only (see
   *  `spain-iva-calculator.ts`), so callers pass `"ES"` today; kept as an
   *  explicit parameter (not hardcoded in the adapter) so a future
   *  multi-country expansion is a call-site change, not a port change. */
  country: string;
}

export interface CreateConnectedAccountResult {
  /** Stripe's own connected account id (`acct_...`) — opaque to the
   *  domain, persisted as `ProfessionalPayoutAccount.stripeExpressAccountId`
   *  so every later onboarding-link/status/login-link call can reference
   *  the same account. */
  stripeAccountId: string;
}

export interface CreateOnboardingLinkOptions {
  /** Where Stripe redirects if the generated link has expired or was
   *  already used — should re-invoke the use case that creates a fresh
   *  link, not just reload the same URL. */
  refreshUrl: string;
  /** Where Stripe redirects once the professional completes (or exits)
   *  the hosted onboarding flow. Reaching this URL is not itself proof
   *  onboarding succeeded — the caller must still call
   *  `retrieveAccountStatus`/`GetStripeAccountStatusUseCase` to find out
   *  (see Stripe's own "Handle the user returning to your platform"
   *  guidance). */
  returnUrl: string;
}

export interface CreateOnboardingLinkResult {
  /** Single-use, short-lived hosted URL. Never persisted — regenerate via
   *  another `createOnboardingLink` call if a caller needs one again
   *  after this expires (mirrors `VerificationProvider
   *  .generateVerificationLink`'s own "never persisted, regenerate on
   *  demand" convention). */
  url: string;
  expiresAt: Date;
}

export interface CreateLoginLinkResult {
  /** Single-use hosted Stripe Express Dashboard URL for the connected
   *  account. Never persisted, for the same reason
   *  `CreateOnboardingLinkResult.url` never is. */
  url: string;
}

export interface StripeAccountStatusResult {
  stripeAccountId: string;
  detailsSubmitted: boolean;
  /** Whether Stripe's `transfers` capability is `active` for this
   *  account — i.e. whether the platform can currently create a
   *  `Transfer` to it. Deliberately NOT `account.charges_enabled`: see
   *  this port's own doc comment and `StripeConnectGatewayAdapter
   *  .retrieveAccountStatus`'s inline comment (post-audit correction) —
   *  `charges_enabled` reflects charge-processing capability
   *  (`card_payments`) this integration never requests, so it would
   *  never meaningfully become `true`. */
  transfersActive: boolean;
  /** Stripe's own `account.payouts_enabled` — whether funds already in
   *  this account's Stripe balance can be paid out to its external bank
   *  account. Distinct from `transfersActive`: see `domain/services/
   *  stripe-connect-account-rules.ts`'s own doc comment for why both are
   *  read independently rather than collapsed into one flag. */
  payoutsEnabled: boolean;
  /** Stripe's own `requirements.currently_due` field keys (e.g.
   *  `"individual.verification.document"`) — kept only for
   *  observability/admin diagnostics. Never itself the input to any
   *  business decision; see `StripeConnectAccountState
   *  .requirementsCurrentlyDue` (`domain/services/stripe-connect-account-
   *  rules.ts`) for the boolean domain code actually reasons about. */
  requirementsCurrentlyDue: string[];
  /** Stripe's own `requirements.disabled_reason`, if the account is
   *  currently restricted from processing — `null` otherwise. Diagnostic
   *  only, same reasoning as `requirementsCurrentlyDue`. */
  disabledReason: string | null;
}

export interface StripeConnectGateway {
  /** Creates a new Stripe Express connected account. Idempotent at the
   *  Stripe API level via a deterministic idempotency key derived from
   *  `request.professionalProfileId` (see `CreateConnectedAccountRequest`'s
   *  own doc comment) — a retried call after a crash-before-persist
   *  returns the same account rather than creating a second one.
   *  Callers are still responsible for their own application-level
   *  idempotency check (never calling this a second time once
   *  `ProfessionalPayoutAccount.stripeExpressAccountId` is already set)
   *  — see `CreateStripeConnectedAccountUseCase`. */
  createConnectedAccount(request: CreateConnectedAccountRequest): Promise<CreateConnectedAccountResult>;

  /** Generates a fresh hosted onboarding link for an existing connected
   *  account. Not idempotent by design — Stripe account links are
   *  single-use and short-lived, so a caller is expected to request a new
   *  one each time the professional needs to (re)enter the hosted flow. */
  createOnboardingLink(
    stripeAccountId: string,
    options: CreateOnboardingLinkOptions,
  ): Promise<CreateOnboardingLinkResult>;

  /** Reads the connected account's current state directly from Stripe —
   *  the synchronization point `GetStripeAccountStatusUseCase` calls, and
   *  the same shape a future Module 72 webhook handler would reconcile
   *  against for `account.updated` events. */
  retrieveAccountStatus(stripeAccountId: string): Promise<StripeAccountStatusResult>;

  /** Generates a single-use Stripe Express Dashboard login link for an
   *  already-onboarded connected account. Stripe itself rejects this for
   *  an account that hasn't completed onboarding — the adapter surfaces
   *  that as a `StripeConnectError`, this port does not pre-validate it. */
  createLoginLink(stripeAccountId: string): Promise<CreateLoginLinkResult>;
}
