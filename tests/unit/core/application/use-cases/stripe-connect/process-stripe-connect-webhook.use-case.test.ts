import { beforeEach, describe, expect, it } from "vitest";

import { ProcessStripeConnectWebhookUseCase } from "@/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case";
import type { StripeConnectWebhookEvent } from "@/application/ports/stripe-connect-webhook-verifier";
import { FakeProfessionalOnboardingRepository, FakeProfessionalRepository } from "../onboarding/fakes";
import { FakeExternalWebhookEventRepository, FakePayoutRepository } from "./fakes";

/**
 * Module 72 — Stripe Webhooks: tests for `ProcessStripeConnectWebhookUseCase`
 * — the application-layer piece `/api/webhooks/stripe/route.ts` delegates
 * to once `StripeConnectWebhookVerifier.verify` has already checked the
 * request's signature (see that route's own doc comment; HTTP wiring
 * itself is covered separately by
 * tests/unit/app/api/webhooks/stripe-route.test.ts, and signature
 * verification itself by
 * tests/unit/core/infrastructure/payments/stripe-connect-webhook-verifier.test.ts).
 * Real use case + fake repositories, reusing Module 71's own
 * `FakeProfessionalOnboardingRepository` — the identical fake
 * `GetStripeAccountStatusUseCase`'s own test suite already uses, so a
 * webhook-driven sync and a poll-driven sync are proven against the same
 * persistence fake.
 */

function accountUpdatedEvent(overrides: Partial<StripeConnectWebhookEvent> = {}): StripeConnectWebhookEvent {
  return {
    id: "evt_1",
    type: "account.updated",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    accountUpdated: {
      stripeAccountId: "acct_1",
      detailsSubmitted: true,
      transfersActive: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
      disabledReason: null,
    },
    transferCreated: null,
    ...overrides,
  };
}

/** Module 76 — Professional Payout Execution. */
function transferCreatedEvent(overrides: Partial<StripeConnectWebhookEvent> = {}): StripeConnectWebhookEvent {
  return {
    id: "evt_transfer_1",
    type: "transfer.created",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    accountUpdated: null,
    transferCreated: {
      stripeTransferId: "tr_1",
      destinationStripeAccountId: "acct_1",
      payoutId: "payout-1",
    },
    ...overrides,
  };
}

describe("ProcessStripeConnectWebhookUseCase (Module 72)", () => {
  let professionals: FakeProfessionalRepository;
  let onboardings: FakeProfessionalOnboardingRepository;
  let webhookEvents: FakeExternalWebhookEventRepository;
  let useCase: ProcessStripeConnectWebhookUseCase;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    onboardings = new FakeProfessionalOnboardingRepository();
    webhookEvents = new FakeExternalWebhookEventRepository();
    useCase = new ProcessStripeConnectWebhookUseCase(onboardings, webhookEvents);
  });

  async function seedPayoutAccount(overrides: { stripeExpressAccountId?: string | null } = {}) {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, {
      stripeExpressAccountId: overrides.stripeExpressAccountId ?? "acct_1",
    });
    return professional;
  }

  describe("account.updated: state synchronization", () => {
    it("promotes to READY when transfers active + payouts enabled + details submitted", async () => {
      const professional = await seedPayoutAccount();

      const result = await useCase.execute(accountUpdatedEvent());

      expect(result.outcome).toBe("processed");
      const payoutAccount = await onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
      expect(payoutAccount?.stripeExpressStatus).toBe("READY");
      expect(payoutAccount?.stripeChargesEnabled).toBe(true);
      expect(payoutAccount?.stripePayoutsEnabled).toBe(true);
      expect(payoutAccount?.stripeDetailsSubmitted).toBe(true);
      expect(payoutAccount?.stripeRequirementsCurrentlyDue).toBe(false);
      expect(payoutAccount?.stripeConnectSyncedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    });

    it("stays PENDING when transfers are not active, even if payouts are enabled", async () => {
      await seedPayoutAccount();

      const result = await useCase.execute(
        accountUpdatedEvent({
          accountUpdated: {
            stripeAccountId: "acct_1",
            detailsSubmitted: true,
            transfersActive: false,
            payoutsEnabled: true,
            requirementsCurrentlyDue: [],
            disabledReason: null,
          },
        }),
      );

      expect(result.outcome).toBe("processed");
      const payoutAccount = await onboardings.findPayoutAccountByStripeAccountId("acct_1");
      expect(payoutAccount?.stripeExpressStatus).toBe("PENDING");
    });

    it("stays PENDING when payouts are disabled, even if transfers are active", async () => {
      await seedPayoutAccount();

      await useCase.execute(
        accountUpdatedEvent({
          accountUpdated: {
            stripeAccountId: "acct_1",
            detailsSubmitted: true,
            transfersActive: true,
            payoutsEnabled: false,
            requirementsCurrentlyDue: [],
            disabledReason: null,
          },
        }),
      );

      const payoutAccount = await onboardings.findPayoutAccountByStripeAccountId("acct_1");
      expect(payoutAccount?.stripeExpressStatus).toBe("PENDING");
    });

    it("stays PENDING when details have not been submitted yet", async () => {
      await seedPayoutAccount();

      await useCase.execute(
        accountUpdatedEvent({
          accountUpdated: {
            stripeAccountId: "acct_1",
            detailsSubmitted: false,
            transfersActive: true,
            payoutsEnabled: true,
            requirementsCurrentlyDue: [],
            disabledReason: null,
          },
        }),
      );

      const payoutAccount = await onboardings.findPayoutAccountByStripeAccountId("acct_1");
      expect(payoutAccount?.stripeExpressStatus).toBe("PENDING");
    });

    it("mirrors non-empty requirementsCurrentlyDue as a boolean, never the raw requirement list", async () => {
      await seedPayoutAccount();

      await useCase.execute(
        accountUpdatedEvent({
          accountUpdated: {
            stripeAccountId: "acct_1",
            detailsSubmitted: true,
            transfersActive: true,
            payoutsEnabled: true,
            requirementsCurrentlyDue: ["individual.verification.document"],
            disabledReason: null,
          },
        }),
      );

      const payoutAccount = await onboardings.findPayoutAccountByStripeAccountId("acct_1");
      expect(payoutAccount?.stripeRequirementsCurrentlyDue).toBe(true);
    });
  });

  describe("idempotency", () => {
    it("processes the same event id only once when delivered twice sequentially", async () => {
      await seedPayoutAccount();

      const first = await useCase.execute(accountUpdatedEvent());
      const second = await useCase.execute(accountUpdatedEvent());

      expect(first.outcome).toBe("processed");
      expect(second.outcome).toBe("duplicate");
    });

    it("processes the same event id only once when delivered concurrently", async () => {
      await seedPayoutAccount();

      const [a, b] = await Promise.all([useCase.execute(accountUpdatedEvent()), useCase.execute(accountUpdatedEvent())]);

      const outcomes = [a.outcome, b.outcome].sort();
      expect(outcomes).toEqual(["duplicate", "processed"]);
    });

    it("safely acknowledges an already-processed event without re-touching state", async () => {
      const professional = await seedPayoutAccount();
      await useCase.execute(accountUpdatedEvent());

      // A very different (but same event id) payload arriving on retry
      // must never be re-applied once the event is already PROCESSED.
      const result = await useCase.execute(
        accountUpdatedEvent({
          accountUpdated: {
            stripeAccountId: "acct_1",
            detailsSubmitted: false,
            transfersActive: false,
            payoutsEnabled: false,
            requirementsCurrentlyDue: ["individual.verification.document"],
            disabledReason: "requirements.past_due",
          },
        }),
      );

      expect(result.outcome).toBe("duplicate");
      const payoutAccount = await onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
      expect(payoutAccount?.stripeExpressStatus).toBe("READY");
    });
  });

  describe("unknown account", () => {
    it("acknowledges a validly-signed event for an unknown Stripe account without creating anything", async () => {
      const result = await useCase.execute(accountUpdatedEvent({ accountUpdated: { ...accountUpdatedEvent().accountUpdated!, stripeAccountId: "acct_unknown" } }));

      expect(result.outcome).toBe("unmatched");
      expect(onboardings.payoutAccounts.size).toBe(0);
    });
  });

  describe("unsupported event types", () => {
    it("acknowledges a non-account.updated event as ignored, without touching any payout account", async () => {
      await seedPayoutAccount();

      const result = await useCase.execute({
        id: "evt_capability",
        type: "capability.updated",
        createdAt: new Date(),
        accountUpdated: null,
        transferCreated: null,
      });

      expect(result.outcome).toBe("ignored");
    });
  });

  describe("out-of-order delivery", () => {
    it("does not let an older account.updated event overwrite a newer already-synced state", async () => {
      const professional = await seedPayoutAccount();

      // A later event (by created time) arrives first and is processed.
      await useCase.execute(
        accountUpdatedEvent({
          id: "evt_new",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          accountUpdated: {
            stripeAccountId: "acct_1",
            detailsSubmitted: true,
            transfersActive: true,
            payoutsEnabled: true,
            requirementsCurrentlyDue: [],
            disabledReason: null,
          },
        }),
      );

      // An older, delayed event (different event id, so not a duplicate)
      // is delivered afterward.
      const stale = await useCase.execute(
        accountUpdatedEvent({
          id: "evt_old",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          accountUpdated: {
            stripeAccountId: "acct_1",
            detailsSubmitted: false,
            transfersActive: false,
            payoutsEnabled: false,
            requirementsCurrentlyDue: [],
            disabledReason: null,
          },
        }),
      );

      expect(stale.outcome).toBe("stale");
      const payoutAccount = await onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
      expect(payoutAccount?.stripeExpressStatus).toBe("READY");
    });

    it("Scenario B/C: an older and a newer event processed concurrently converge on the newer state regardless of interleaving", async () => {
      // Models both a single-instance race between two concurrent
      // requests (Scenario B) and, since the guard this relies on
      // (`updateStripeConnectAccountIfNotStale`) is a single atomic
      // database statement, is the same property that holds across two
      // application instances racing the same account (Scenario C) — the
      // guard is evaluated by Postgres itself at write time, not by
      // either process's in-memory state.
      const professional = await seedPayoutAccount();

      const older = accountUpdatedEvent({
        id: "evt_race_old",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        accountUpdated: {
          stripeAccountId: "acct_1",
          detailsSubmitted: false,
          transfersActive: false,
          payoutsEnabled: false,
          requirementsCurrentlyDue: [],
          disabledReason: null,
        },
      });
      const newer = accountUpdatedEvent({
        id: "evt_race_new",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        accountUpdated: {
          stripeAccountId: "acct_1",
          detailsSubmitted: true,
          transfersActive: true,
          payoutsEnabled: true,
          requirementsCurrentlyDue: [],
          disabledReason: null,
        },
      });

      const [olderResult, newerResult] = await Promise.all([useCase.execute(older), useCase.execute(newer)]);

      // Whichever of the two actually wrote last (an application-level
      // race Promise.all doesn't control), the persisted state must
      // never regress behind the newer event — this is the invariant
      // the atomic guard exists to protect, independent of outcome
      // ordering.
      const payoutAccount = await onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
      expect(payoutAccount?.stripeConnectSyncedAt).toEqual(new Date("2026-01-02T00:00:00Z"));
      expect(payoutAccount?.stripeExpressStatus).toBe("READY");
      expect(payoutAccount?.stripeChargesEnabled).toBe(true);

      // The newer event's own write is never itself rejected as stale,
      // and at least one of the two deliveries actually applied — no
      // event is silently lost.
      expect(newerResult.outcome).toBe("processed");
      expect([olderResult.outcome, newerResult.outcome]).toContain("processed");
    });

    it("Scenario D: the guard is evaluated at write time, not at an earlier read — a newer write followed by an older write is rejected even with no read in between", async () => {
      // Directly exercises `updateStripeConnectAccountIfNotStale` against
      // the repository (bypassing the use case's own orchestration) to
      // isolate the property Scenario D is actually worried about: two
      // callers that both read `stripeConnectSyncedAt` as stale/absent
      // before either has written (impossible to force deterministically
      // through the use case's own `Promise.all`-based interleaving, but
      // trivial to prove directly against the guarded write itself).
      const professional = await seedPayoutAccount();

      const newerWrite = await onboardings.updateStripeConnectAccountIfNotStale(professional.id, {
        stripeExpressStatus: "READY",
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
        stripeRequirementsCurrentlyDue: false,
        stripeConnectSyncedAt: new Date("2026-01-02T00:00:00Z"),
      });
      expect(newerWrite.applied).toBe(true);

      // An older write arrives after — even though no code path re-read
      // the row in between, the guard (evaluated fresh, in the database,
      // at this exact call) still correctly rejects it.
      const olderWrite = await onboardings.updateStripeConnectAccountIfNotStale(professional.id, {
        stripeExpressStatus: "PENDING",
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
        stripeDetailsSubmitted: false,
        stripeRequirementsCurrentlyDue: false,
        stripeConnectSyncedAt: new Date("2026-01-01T00:00:00Z"),
      });
      expect(olderWrite.applied).toBe(false);

      const payoutAccount = await onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
      expect(payoutAccount?.stripeExpressStatus).toBe("READY");
      expect(payoutAccount?.stripeConnectSyncedAt).toEqual(new Date("2026-01-02T00:00:00Z"));
    });

    it("applies a retry of the exact same event even though its own createdAt equals the just-written stripeConnectSyncedAt", async () => {
      // Proves the claim()→success→markProcessed-fails→retry sequence
      // (§4 of the audit) is safe: the guard uses a strict `<`, so a
      // retried delivery of the SAME event (same `createdAt` as what it
      // already wrote) is never itself rejected as stale.
      const professional = await seedPayoutAccount();
      const event = accountUpdatedEvent({ id: "evt_retry_same_ts", createdAt: new Date("2026-01-01T00:00:00Z") });

      const first = await useCase.execute(event);
      expect(first.outcome).toBe("processed");

      // Simulate Stripe's own retry of the identical event id/timestamp
      // by writing directly against the repository with the same
      // timestamp the first call already persisted.
      const retryWrite = await onboardings.updateStripeConnectAccountIfNotStale(professional.id, {
        stripeExpressStatus: "READY",
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
        stripeRequirementsCurrentlyDue: false,
        stripeConnectSyncedAt: new Date("2026-01-01T00:00:00Z"),
      });
      expect(retryWrite.applied).toBe(true);
    });
  });

  describe("failure semantics", () => {
    it("marks the event FAILED (never PROCESSED) and rethrows when the repository write fails", async () => {
      await seedPayoutAccount();
      const originalUpdate = onboardings.updateStripeConnectAccountIfNotStale.bind(onboardings);
      onboardings.updateStripeConnectAccountIfNotStale = async () => {
        throw new Error("database is down");
      };

      await expect(useCase.execute(accountUpdatedEvent())).rejects.toThrow("database is down");

      const failedRecord = [...webhookEvents.events.values()].find((e) => e.externalEventId === "evt_1");
      expect(failedRecord?.status).toBe("FAILED");

      // A later retry of the same event, once the repository recovers,
      // succeeds — the FAILED status is re-claimable.
      onboardings.updateStripeConnectAccountIfNotStale = originalUpdate;
      const retried = await useCase.execute(accountUpdatedEvent());
      expect(retried.outcome).toBe("processed");
    });

    it("§4 audit scenario: claim succeeds, the state write succeeds, but markProcessed fails — a Stripe retry of the same event is still safe", async () => {
      // This is the sequence the audit specifically asked to be proven
      // safe: `claim()` succeeds, `updateStripeConnectAccountIfNotStale`
      // succeeds (state is already correctly persisted), but
      // `markProcessed()` itself then fails (e.g. a dropped connection
      // between the two calls) — the use case's catch block marks the
      // event FAILED and rethrows, so Stripe will retry the identical
      // event id. Proven safe here NOT by a second idempotency
      // mechanism, but because `updateStripeConnectAccountIfNotStale` is
      // itself idempotent for a retried delivery of the *same* event: the
      // guard uses strict `<`, so re-applying the exact same
      // `stripeConnectSyncedAt` the first (successful) write already
      // persisted is accepted again (`applied: true`), and re-writes the
      // identical field values — never a different, duplicated, or
      // corrupted state.
      const professional = await seedPayoutAccount();

      const originalMarkProcessed = webhookEvents.markProcessed.bind(webhookEvents);
      webhookEvents.markProcessed = async () => {
        throw new Error("connection dropped after the state write committed");
      };

      const event = accountUpdatedEvent({ id: "evt_markprocessed_fails" });
      await expect(useCase.execute(event)).rejects.toThrow("connection dropped after the state write committed");

      // The state write itself DID succeed before markProcessed failed —
      // this is the crux of the audit question.
      const afterFirstAttempt = await onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
      expect(afterFirstAttempt?.stripeExpressStatus).toBe("READY");
      expect(afterFirstAttempt?.stripeConnectSyncedAt).toEqual(event.createdAt);

      const failedRecord = [...webhookEvents.events.values()].find((e) => e.externalEventId === "evt_markprocessed_fails");
      expect(failedRecord?.status).toBe("FAILED");

      // Stripe's own retry of the identical event now arrives.
      webhookEvents.markProcessed = originalMarkProcessed;
      const retried = await useCase.execute(event);

      // Safe: the retry re-applies the identical state (never rejected as
      // stale, since its timestamp equals — not precedes — what's
      // already on file) and this time markProcessed succeeds.
      expect(retried.outcome).toBe("processed");
      const afterRetry = await onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
      expect(afterRetry?.stripeExpressStatus).toBe("READY");
      expect(afterRetry?.stripeConnectSyncedAt).toEqual(event.createdAt);
      const finalRecord = [...webhookEvents.events.values()].find((e) => e.externalEventId === "evt_markprocessed_fails");
      expect(finalRecord?.status).toBe("PROCESSED");
    });
  });

  describe("transfer.created reconciliation (Module 76)", () => {
    let payouts: FakePayoutRepository;
    let useCaseWithPayouts: ProcessStripeConnectWebhookUseCase;

    beforeEach(() => {
      payouts = new FakePayoutRepository();
      useCaseWithPayouts = new ProcessStripeConnectWebhookUseCase(onboardings, webhookEvents, payouts);
    });

    it("reconciles a PENDING payout to PAID on transfer.created", async () => {
      const payout = payouts.seed({ jobId: "job-1", status: "PENDING" });

      const result = await useCaseWithPayouts.execute(
        transferCreatedEvent({ transferCreated: { stripeTransferId: "tr_1", destinationStripeAccountId: "acct_1", payoutId: payout.id } }),
      );

      expect(result.outcome).toBe("transfer-reconciled");
      const updated = await payouts.findById(payout.id);
      expect(updated?.status).toBe("PAID");
      expect(updated?.stripeTransferId).toBe("tr_1");
    });

    it("reconciles a FAILED payout to PAID (a self-healing retry after a lost response)", async () => {
      const payout = payouts.seed({ jobId: "job-2", status: "FAILED", failureReason: "network timeout" });

      const result = await useCaseWithPayouts.execute(
        transferCreatedEvent({ id: "evt_transfer_2", transferCreated: { stripeTransferId: "tr_2", destinationStripeAccountId: "acct_1", payoutId: payout.id } }),
      );

      expect(result.outcome).toBe("transfer-reconciled");
      const updated = await payouts.findById(payout.id);
      expect(updated?.status).toBe("PAID");
      expect(updated?.failureReason).toBeNull();
    });

    it("never regresses an already-PAID payout — duplicate/out-of-order delivery is a safe no-op", async () => {
      const payout = payouts.seed({ jobId: "job-3", status: "PAID", stripeTransferId: "tr_original" });

      const result = await useCaseWithPayouts.execute(
        transferCreatedEvent({ id: "evt_transfer_3", transferCreated: { stripeTransferId: "tr_original", destinationStripeAccountId: "acct_1", payoutId: payout.id } }),
      );

      expect(result.outcome).toBe("transfer-reconciled");
      const updated = await payouts.findById(payout.id);
      expect(updated?.status).toBe("PAID");
      expect(updated?.stripeTransferId).toBe("tr_original");
    });

    it("acknowledges a transfer event with no matching payoutId as transfer-unmatched", async () => {
      const result = await useCaseWithPayouts.execute(
        transferCreatedEvent({ id: "evt_transfer_4", transferCreated: { stripeTransferId: "tr_4", destinationStripeAccountId: "acct_1", payoutId: "payout-does-not-exist" } }),
      );

      expect(result.outcome).toBe("transfer-unmatched");
    });

    it("acknowledges a transfer event with no payoutId metadata as transfer-unmatched", async () => {
      const result = await useCaseWithPayouts.execute(
        transferCreatedEvent({ id: "evt_transfer_5", transferCreated: { stripeTransferId: "tr_5", destinationStripeAccountId: "acct_1", payoutId: null } }),
      );

      expect(result.outcome).toBe("transfer-unmatched");
    });

    it("deduplicates a transfer.created event delivered twice", async () => {
      const payout = payouts.seed({ jobId: "job-6", status: "PENDING" });
      const event = transferCreatedEvent({ id: "evt_transfer_6", transferCreated: { stripeTransferId: "tr_6", destinationStripeAccountId: "acct_1", payoutId: payout.id } });

      const first = await useCaseWithPayouts.execute(event);
      const second = await useCaseWithPayouts.execute(event);

      expect(first.outcome).toBe("transfer-reconciled");
      expect(second.outcome).toBe("duplicate");
    });

    it("without a payouts repository configured, safely ignores a transfer.created event rather than throwing", async () => {
      // `useCase` (module-level beforeEach) is constructed with only 2
      // args — the pre-Module-76 composition shape.
      const result = await useCase.execute(transferCreatedEvent({ id: "evt_transfer_7" }));
      expect(result.outcome).toBe("transfer-unmatched");
    });
  });
});
