/**
 * Module 71 — Stripe Connect.
 *
 * Pure, dependency-free business rules for interpreting a professional's
 * Stripe Connect (Express) account state — the same "small helper, no
 * Stripe SDK, no I/O" style as `professional-onboarding-rules.ts`. Nothing
 * here imports the Stripe SDK or any infrastructure type; it only operates
 * on the plain booleans a `StripeConnectGateway`
 * (`application/ports/stripe-connect-gateway.ts`) reports back.
 *
 * This file exists to keep three distinct concepts from ever collapsing
 * into a single boolean, per the module brief:
 *   - MaestroYa professional status (`ProfessionalProfile.status`) — an
 *     entirely separate account-lifecycle concept this file does not
 *     touch.
 *   - Stripe Connect account status (`StripeExpressReadinessValue` —
 *     `professional-onboarding-rules.ts`) — has an account been created
 *     and has onboarding been completed.
 *   - Payout eligibility (`isStripePayoutEligible` below) — can this
 *     specific account actually receive a transfer right now.
 *
 * A professional can have a fully "READY" Stripe account today and still
 * become payout-ineligible tomorrow (Stripe restricts the account pending
 * new requirements) without their MaestroYa account status changing at
 * all — these three states are read independently, never derived from
 * one another.
 *
 * ## Post-audit correction — why `charges_enabled` was removed
 * The first version of this file gated readiness on
 * `chargesEnabled && payoutsEnabled`. That was wrong for this Connect
 * model: MaestroYa's connected accounts request only the `transfers`
 * capability (see `StripeConnectGatewayAdapter.createConnectedAccount`'s
 * own comment) — every customer charge happens on the *platform's*
 * Stripe account, never on a professional's connected account. Stripe
 * defines `account.charges_enabled` as "whether the account can process
 * charges" (https://docs.stripe.com/api/accounts/object), and ties actual
 * charge-processing ability to the `card_payments` capability
 * (https://docs.stripe.com/connect/account-capabilities: "Connected
 * accounts with the card_payments capability can receive payments from
 * your platform and directly process card and ACH payments"). Since this
 * integration never requests `card_payments`, `charges_enabled` would
 * read `false` forever regardless of how fully onboarded the account is
 * — a permanently-false term in an AND gate makes the whole gate
 * permanently false. No professional could ever have reached
 * payout-eligible or `READY` under the original formula.
 *
 * The corrected model reads the two signals that actually govern this
 * Connect model, both already returned by the same `accounts.retrieve`
 * call (no extra Stripe API call):
 *   - **Transfer readiness** (`transfersActive`) — is Stripe's
 *     `capabilities.transfers` status `"active"`, i.e. can the platform
 *     currently create a `Transfer` *into* this account.
 *   - **Payout readiness** (`payoutsEnabled`) — Stripe's own
 *     `payouts_enabled`, i.e. can funds already in the account's Stripe
 *     balance be paid *out* to its external bank account.
 * Both must hold for MaestroYa to treat the account as able to receive
 * and eventually disburse a transfer — see `isStripePayoutEligible`.
 * Neither is a substitute for the other: an account can have transfers
 * active (money can arrive) while payouts remain disabled (pending bank
 * account verification), or vice versa is not expected under this
 * account's single requested capability, but both are still checked
 * independently rather than assuming one implies the other.
 */

import type { StripeExpressReadinessValue } from "@/domain/services/professional-onboarding-rules";

/** The subset of a Stripe Connect account's own state this module cares
 *  about — `details_submitted` plus the two capability/status signals
 *  this Connect model actually depends on (`transfers` capability status
 *  and `payouts_enabled` — see this file's own "post-audit correction"
 *  doc comment for why `charges_enabled` is deliberately excluded) plus
 *  `requirements.currently_due`, not a re-derived summary. See
 *  `StripeAccountStatusResult` (`application/ports/stripe-connect-
 *  gateway.ts`) for the port-level shape this is built from. */
export interface StripeConnectAccountState {
  detailsSubmitted: boolean;
  /** Whether Stripe's `transfers` capability is `active` for this
   *  account — whether the platform can currently create a `Transfer`
   *  to it. */
  transfersActive: boolean;
  /** Whether funds already in this account's Stripe balance can be paid
   *  out to its external bank account. */
  payoutsEnabled: boolean;
  /** `true` when Stripe's `requirements.currently_due` is non-empty for
   *  this account — never the requirement list itself (that is
   *  Stripe-internal diagnostic detail, not a domain concept this
   *  platform reasons about beyond "something is blocking this
   *  account"). */
  requirementsCurrentlyDue: boolean;
}

/**
 * Whether a professional's Stripe Connect account can receive a transfer
 * right now. Deliberately does not consider `detailsSubmitted` — an
 * account can have `transfersActive`/`payoutsEnabled` both `true` while
 * still having non-blocking "eventually due" requirements pending; this
 * platform's only hard gate on "can money move" is the two capability/
 * status flags Stripe itself uses to decide whether it will process a
 * transfer and a subsequent payout.
 */
export function isStripePayoutEligible(state: StripeConnectAccountState): boolean {
  return state.transfersActive && state.payoutsEnabled;
}

/**
 * Derives the coarse `StripeExpressReadinessValue` this platform persists
 * (`ProfessionalPayoutAccount.stripeExpressStatus`) from a freshly-read
 * Stripe account state — the single place `GetStripeAccountStatusUseCase`
 * decides the transition into/out of `READY`, so two call sites can never
 * disagree about what "ready" means. `NOT_STARTED`/`PENDING` are
 * unaffected by this function (they are set at payout-method-selection
 * time and connected-account-creation time respectively — see
 * `SetPayoutDestinationUseCase`/`CreateStripeConnectedAccountUseCase`);
 * this only ever computes `PENDING` (still onboarding) vs `READY` (fully
 * onboarded) for an account that already exists.
 */
export function deriveStripeExpressReadiness(state: StripeConnectAccountState): StripeExpressReadinessValue {
  const fullyOnboarded = state.detailsSubmitted && state.transfersActive && state.payoutsEnabled;
  return fullyOnboarded ? "READY" : "PENDING";
}
