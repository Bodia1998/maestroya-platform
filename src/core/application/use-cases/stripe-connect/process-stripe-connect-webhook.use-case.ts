import { deriveStripeExpressReadiness } from "@/domain/services/stripe-connect-account-rules";
import type { ExternalWebhookEventRepository } from "@/domain/repositories/external-webhook-event-repository";
import type { ProfessionalOnboardingRepository } from "@/domain/repositories/professional-onboarding-repository";
import type { PayoutRepository } from "@/domain/repositories/payout-repository";
import type { StripeConnectWebhookEvent } from "@/application/ports/stripe-connect-webhook-verifier";

export type ProcessStripeConnectWebhookOutcome =
  /** First delivery (or a retry of a previously failed delivery) of an
   *  `account.updated` event for an account this platform knows about:
   *  `ProfessionalPayoutAccount`'s Stripe-mirrored fields were updated. */
  | "processed"
  /** This exact Stripe event id was already claimed by an earlier
   *  delivery (in-flight or completed) — no side effect ran this time,
   *  by design. See `ExternalWebhookEventRepository.claim`'s own doc
   *  comment. */
  | "duplicate"
  /** Signature-valid event of a type this module doesn't act on (only
   *  `account.updated` is in scope — see this module's own
   *  implementation report for why `account.application.deauthorized`
   *  was deliberately not implemented). Acknowledged, nothing to
   *  synchronize. */
  | "ignored"
  /** A validly-signed `account.updated` event for a Stripe connected
   *  account id this platform has no `ProfessionalPayoutAccount` for.
   *  Acknowledged (never a 4xx — retrying would never make it match) but
   *  distinct from `"ignored"` for observability. Never creates a
   *  professional or payout account — see this class's own doc
   *  comment. */
  | "unmatched"
  /** A validly-signed, matched `account.updated` event whose own
   *  `created` timestamp is older than the last Stripe state this
   *  platform already recorded for the account (from a later webhook or
   *  a later poll) — see this class's own "out-of-order delivery" doc
   *  comment. Acknowledged without overwriting the newer state. */
  | "stale"
  /** Module 76 — Professional Payout Execution: a `transfer.created`
   *  event successfully reconciled a `Payout` row from `PENDING`/
   *  `IN_TRANSIT`/`FAILED` to `PAID` — the self-healing path for "Stripe
   *  accepted the transfer but this platform's own process crashed (or
   *  its Stripe API response was lost) before persisting that" — see
   *  this class's own "transfer reconciliation" doc comment. */
  | "transfer-reconciled"
  /** Module 76 — Professional Payout Execution: a validly-signed
   *  `transfer.created` event whose `metadata.payoutId` does not match any
   *  `Payout` this platform has (or carries no `payoutId` metadata at
   *  all) — acknowledged, nothing to reconcile. Mirrors `"unmatched"`'s
   *  own reasoning for `account.updated`, kept as a distinct outcome for
   *  observability. */
  | "transfer-unmatched";

export interface ProcessStripeConnectWebhookResult {
  outcome: ProcessStripeConnectWebhookOutcome;
  professionalProfileId?: string;
}

/**
 * Module 72 — Stripe Webhooks.
 *
 * The application-layer use case `src/app/api/webhooks/stripe/route.ts`
 * delegates to, once the Route Handler has already verified the inbound
 * request's signature via `StripeConnectWebhookVerifier`
 * (`application/ports/stripe-connect-webhook-verifier.ts`) — see that
 * port's own doc comment. This use case is never itself given a raw body
 * or a signature header, and never re-implements or duplicates that
 * verification; it only ever receives an already-verified
 * `StripeConnectWebhookEvent`.
 *
 * ## Reuses Module 71 end to end
 * This is deliberately *not* a second state machine. The exact same
 * `deriveStripeExpressReadiness` (`domain/services/stripe-connect-
 * account-rules.ts`) and `ProfessionalOnboardingRepository
 * .updateStripeConnectAccount` that `GetStripeAccountStatusUseCase`
 * (Module 71's polling path) already uses are the only two things this
 * use case calls to turn a Stripe `Account` payload into a persisted
 * state — a webhook-driven sync and a poll-driven sync can never
 * disagree about what a given Stripe account state means, because they
 * run the identical mapping.
 *
 * ## Idempotency
 * `ExternalWebhookEventRepository.claim()` is called before anything else
 * — a duplicate delivery of the same Stripe event (Stripe's own retry, or
 * two concurrent deliveries) short-circuits to `"duplicate"` with zero
 * side effects, DB-uniqueness-backed (see that repository's own doc
 * comment). Provider key is `"STRIPE"`, distinct from Persona's
 * `"PERSONA"` — the same `(provider, externalEventId)` ledger already
 * backs both, per that repository's own "provider-agnostic" design.
 *
 * ## IDOR/unknown-account safety
 * The event's Stripe account id is resolved against this platform's own
 * `ProfessionalOnboardingRepository.findPayoutAccountByStripeAccountId` —
 * never trusted as, or used to look up, any MaestroYa-side identifier
 * directly. If it doesn't match an account this platform actually
 * created (e.g. a Connect account from a different, unrelated Stripe
 * platform integration test, or an account whose payout method was since
 * switched away from Stripe Express — see `upsertPayoutAccount`'s own
 * doc comment on clearing `stripeExpressAccountId`), the event is
 * acknowledged as `"unmatched"` and nothing is written. This use case
 * never creates a `ProfessionalProfile` or `ProfessionalPayoutAccount` —
 * only `SetPayoutDestinationUseCase`/`CreateStripeConnectedAccountUseCase`
 * (Module 62/71) do that, driven by the professional's own action.
 *
 * ## Out-of-order delivery (post-audit correction)
 * Stripe explicitly does not guarantee webhook delivery order. Without a
 * schema change, `ProfessionalPayoutAccountRecord.stripeConnectSyncedAt`
 * (Module 71) is the one existing signal this platform has for "how
 * fresh is the state currently on file" — `GetStripeAccountStatusUseCase`
 * already sets it to the poll's own wall-clock time (a poll always
 * reflects Stripe's live current state, at least as fresh as any past
 * event). This use case extends the same field to webhook-driven syncs
 * via `ProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale`
 * — a single atomic `WHERE stripeConnectSyncedAt IS NULL OR <=
 * :incoming` write (see that method's own doc comment — `<=`, not `<`,
 * so a retried delivery of the *same* event, whose `createdAt` equals
 * what an earlier attempt already persisted, is still accepted; only a
 * strictly *older* event is rejected). An event whose own `createdAt` is
 * strictly older than the row's current `stripeConnectSyncedAt` at the
 * moment the database evaluates the `WHERE` clause has `applied: false`
 * — reported as `"stale"` (acknowledged so Stripe doesn't retry it
 * forever, but never applied).
 *
 * This is a genuine, database-enforced ordering guarantee, not a
 * best-effort one: the comparison and the write happen in the same
 * statement, so there is no "read `stripeConnectSyncedAt`, decide in
 * this process, then write" window for two concurrent/out-of-order
 * deliveries (whether on one instance or many) to race through. Exactly
 * one of two concurrently-processed `account.updated` events for the
 * same account can ever have `applied: true`, and it is always the one
 * whose `event.createdAt` is newer than whatever the other one wrote (or
 * is in the middle of writing) — see the audit's own concurrency tests in
 * `process-stripe-connect-webhook.use-case.test.ts` for scenarios A–D.
 */
export class ProcessStripeConnectWebhookUseCase {
  constructor(
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly webhookEvents: ExternalWebhookEventRepository,
    /** Module 76 — Professional Payout Execution: optional, mirrors
     *  `EvaluatePaymentReleaseUseCase`'s own `companies?` addition (Module
     *  75) — every existing construction of this class (every test, and
     *  any composition root that never wires payout reconciliation) keeps
     *  compiling unchanged. Only needed to reconcile `transfer.created`
     *  events — see `execute`'s own handling below. Calling this with a
     *  `transfer.created` event and no `payouts` configured safely
     *  acknowledges the event as `"ignored"` rather than throwing — a
     *  composition root that hasn't opted into Module 76 must not turn a
     *  benign, already-signature-verified webhook delivery into a 5xx
     *  Stripe will endlessly retry. */
    private readonly payouts?: PayoutRepository,
  ) {}

  async execute(event: StripeConnectWebhookEvent): Promise<ProcessStripeConnectWebhookResult> {
    const claim = await this.webhookEvents.claim({
      provider: "STRIPE",
      externalEventId: event.id,
      eventType: event.type,
    });

    if (!claim.claimed) {
      return { outcome: "duplicate" };
    }

    try {
      if (event.transferCreated) {
        const outcome = await this.reconcileTransferCreated(event.transferCreated);
        await this.webhookEvents.markProcessed(claim.record.id);
        return outcome;
      }

      if (!event.accountUpdated) {
        await this.webhookEvents.markProcessed(claim.record.id);
        return { outcome: "ignored" };
      }

      const payload = event.accountUpdated;
      const payoutAccount = await this.onboardings.findPayoutAccountByStripeAccountId(payload.stripeAccountId);
      if (!payoutAccount) {
        await this.webhookEvents.markProcessed(claim.record.id);
        return { outcome: "unmatched" };
      }

      const requirementsCurrentlyDue = payload.requirementsCurrentlyDue.length > 0;
      const readiness = deriveStripeExpressReadiness({
        detailsSubmitted: payload.detailsSubmitted,
        transfersActive: payload.transfersActive,
        payoutsEnabled: payload.payoutsEnabled,
        requirementsCurrentlyDue,
      });

      // Post-audit correction: the out-of-order guard below used to be a
      // "read `stripeConnectSyncedAt`, compare in this process, then
      // call `updateStripeConnectAccount`" sequence — safe against a
      // single in-process race, but not against two instances (or two
      // concurrent requests) each reading before either had written. This
      // atomic variant folds the comparison into the write's own `WHERE`
      // clause (`updateStripeConnectAccountIfNotStale` —
      // `domain/repositories/professional-onboarding-repository.ts`'s own
      // doc comment), so there is no read-then-write window left to race
      // at all: exactly one of two concurrent out-of-order deliveries can
      // ever have its write actually match a row, and it is always the
      // one carrying the newer `event.createdAt`.
      const { applied } = await this.onboardings.updateStripeConnectAccountIfNotStale(
        payoutAccount.professionalProfileId,
        {
          stripeExpressStatus: readiness,
          // See `ProfessionalPayoutAccountRecord.stripeChargesEnabled`'s
          // own doc comment — this mirrors `transfersActive`, not
          // Stripe's literal `charges_enabled` field. Identical to
          // `GetStripeAccountStatusUseCase`'s own write, deliberately.
          stripeChargesEnabled: payload.transfersActive,
          stripePayoutsEnabled: payload.payoutsEnabled,
          stripeDetailsSubmitted: payload.detailsSubmitted,
          stripeRequirementsCurrentlyDue: requirementsCurrentlyDue,
          stripeConnectSyncedAt: event.createdAt,
        },
      );

      await this.webhookEvents.markProcessed(claim.record.id);

      if (!applied) {
        return { outcome: "stale", professionalProfileId: payoutAccount.professionalProfileId };
      }
      return { outcome: "processed", professionalProfileId: payoutAccount.professionalProfileId };
    } catch (error) {
      // The claim stays claimable by a later retry — see
      // ExternalWebhookEventRepository's own doc comment on why FAILED
      // (and only FAILED) may be re-claimed. Stripe's own delivery retry
      // will naturally re-send a non-2xx-acknowledged webhook.
      await this.webhookEvents.markFailed(claim.record.id);
      throw error;
    }
  }

  /**
   * Module 76 — Professional Payout Execution: transfer reconciliation.
   *
   * `ExecuteProfessionalPayoutUseCase`'s own Stripe-idempotency-key
   * defense already handles the common "network response lost, a retry
   * follows" case by itself (the retried request converges on the same
   * Stripe Transfer). This handler is the second, independent line of
   * defense for the rarer case that same use case's own doc comment
   * anticipates: the process that called Stripe crashes (or is killed)
   * permanently after Stripe already accepted the transfer, with no
   * in-process retry ever following. Without this, such a `Payout` would
   * stay `PENDING`/`FAILED` forever despite the professional having
   * actually been paid. `transfer.created` self-heals it.
   *
   * Never regresses an already-`PAID` row: `markPaid`'s own
   * compare-and-swap `fromStatuses` only matches `PENDING`/`IN_TRANSIT`/
   * `FAILED` — an out-of-order or duplicate delivery of the same event
   * against an already-reconciled row is always a safe no-op, reported
   * the same `"transfer-reconciled"` outcome either way (idempotent from
   * a caller's perspective, exactly like Stripe's own retry expectations).
   */
  private async reconcileTransferCreated(
    payload: NonNullable<StripeConnectWebhookEvent["transferCreated"]>,
  ): Promise<ProcessStripeConnectWebhookResult> {
    if (!this.payouts || !payload.payoutId) {
      return { outcome: "transfer-unmatched" };
    }

    const payout = await this.payouts.findById(payload.payoutId);
    if (!payout) {
      return { outcome: "transfer-unmatched" };
    }

    await this.payouts.markPaid({
      id: payout.id,
      stripeTransferId: payload.stripeTransferId,
      fromStatuses: ["PENDING", "IN_TRANSIT", "FAILED"],
    });

    return { outcome: "transfer-reconciled" };
  }
}
