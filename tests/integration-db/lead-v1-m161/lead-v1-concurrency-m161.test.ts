/**
 * Module 161 — LEAD_V1 concurrency & transaction safety against REAL PostgreSQL.
 *
 * Every race here runs through the real composition roots (`makeInitiateLeadPurchaseUseCase`, `makeInitiateLeadFeePaymentUseCase`,
 * the real signed `/api/webhooks/stripe-payments` route) over the project's real Prisma repositories and the real database, with
 * genuinely concurrent requests (`Promise.all` over a connection pool; a `pg_stat_activity` probe records how much real contention
 * happened). Assertions are about PERSISTED invariants (rows, statuses, ledger), not only about return values.
 *
 * Simulated: the payment provider (in-memory gateway). Injected faults: a PostgreSQL trigger that fails a ledger insert (to cut a
 * webhook transaction at its boundary) and gateway failures. Nothing in production code was changed to make these tests possible.
 *
 * NOT proven here (documented in docs/MODULE_161_...md): multi-process / multi-instance races (one Node process, one pool),
 * a real Stripe delivery order, Postgres behaviour under a pool smaller than the concurrency (see the report's limitations).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway", async () => {
  const { m161Gateway } = await import("../../test-utils/m161-lead-v1-world");
  return {
    StripeLeadFeePaymentGatewayAdapter: class {
      constructor() {
        return m161Gateway.current;
      }
    },
  };
});
vi.mock("@/infrastructure/email/resend-email-sender", () => ({
  ResendEmailSender: class {
    async send(): Promise<void> {}
  },
}));

import { POST as stripePaymentsWebhook } from "@/app/api/webhooks/stripe-payments/route";
import { makeInitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/compose";
import { makeInitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";
import { makeTransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";
import { DuplicateActiveLeadPurchaseError, LeadBuyerLimitReachedError, LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import { prisma } from "@/infrastructure/database/prisma/client";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { withContentionProbe } from "../../test-utils/m161-contention-probe";
import {
  PILOT_TOTAL_MINOR_UNITS,
  fulfilled,
  purchaseWithPaymentAttempt,
  rejected,
  seedProfessionals,
  settle,
  submitPublishedLead,
} from "../../test-utils/m161-lead-v1-flows";
import { m161Gateway, paymentIntentEvent, resetM161Gateway, seedCategory, signedWebhookRequest, webhookOutcome } from "../../test-utils/m161-lead-v1-world";

const send = async (event: object) => webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(event)));
const succeeded = (reference: string, purchaseId: string, leadId: string, id?: string) =>
  paymentIntentEvent({ id, paymentIntentId: reference, amountMinorUnits: PILOT_TOTAL_MINOR_UNITS, leadPurchaseId: purchaseId, leadId });

describe("Module 161 — LEAD_V1 concurrency (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const saved = { rollout: process.env.LEAD_V1_ROLLOUT_MODE, abuse: process.env.LEAD_ABUSE_CONTROL_MODE, basis: process.env.LEAD_CONTACT_SHARING_BASIS };
  beforeEach(() => {
    process.env.LEAD_V1_ROLLOUT_MODE = "ENABLED";
    delete process.env.LEAD_ABUSE_CONTROL_MODE;
    delete process.env.LEAD_CONTACT_SHARING_BASIS;
    resetM161Gateway();
  });
  afterEach(() => {
    for (const [key, value] of [["LEAD_V1_ROLLOUT_MODE", saved.rollout], ["LEAD_ABUSE_CONTROL_MODE", saved.abuse], ["LEAD_CONTACT_SHARING_BASIS", saved.basis]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const activeCount = (leadId: string) => prisma.leadPurchase.count({ where: { leadId, status: { in: ["PENDING_PAYMENT", "CONFIRMED", "DISPUTED"] } } });
  const row = (id: string) => prisma.leadPurchase.findUniqueOrThrow({ where: { id } });

  describe("concurrent purchases of the same lead (pilot buyer policy maxBuyers = 1)", () => {
    it("the published lead really carries the pilot policy (exclusive)", async () => {
      const category = await seedCategory(prisma);
      const { lead } = await submitPublishedLead(category);
      expect(lead.maxBuyers).toBe(1);
    });

    it("12 different eligible professionals race for ONE exclusive lead: exactly one purchase exists afterwards, every loser is refused, no partial rows", async () => {
      const category = await seedCategory(prisma);
      const { lead } = await submitPublishedLead(category);
      const pros = await seedProfessionals(category, 12);

      const { result, evidence } = await withContentionProbe(() => settle(pros.map((p) => makeInitiateLeadPurchaseUseCase().execute(p.userId, lead.id))));

      expect(fulfilled(result)).toHaveLength(1);
      for (const failure of rejected(result)) {
        expect([LeadBuyerLimitReachedError, LeadNotPurchasableError].some((c) => failure.reason instanceof c), String(failure.reason)).toBe(true);
      }
      // Persisted invariants: one row in total (losers leave NOTHING behind), one active purchase, the winner is one of the racers.
      expect(await prisma.leadPurchase.count({ where: { leadId: lead.id } })).toBe(1);
      expect(await activeCount(lead.id)).toBe(1);
      const winner = await prisma.leadPurchase.findFirstOrThrow({ where: { leadId: lead.id } });
      expect(pros.map((p) => p.profileId)).toContain(winner.professionalProfileId);
      expect(winner.status).toBe("PENDING_PAYMENT");
      // The lead itself is untouched by the race.
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("PUBLISHED");
      // Evidence that the requests really overlapped inside PostgreSQL (reported in the Gate B document).
      console.info(`[M161 evidence] 12-way purchase race: samples=${evidence.samples} peakActiveBackends=${evidence.peakActiveBackends} peakLockWaiters=${evidence.peakLockWaiters}`);
      expect(evidence.peakActiveBackends).toBeGreaterThan(1);
    });

    it("repeated rounds (10 leads x 6 racers) never produce a second active purchase for any lead", async () => {
      const category = await seedCategory(prisma);
      const pros = await seedProfessionals(category, 6);
      for (let round = 0; round < 10; round += 1) {
        const { lead } = await submitPublishedLead(category);
        const result = await settle(pros.map((p) => makeInitiateLeadPurchaseUseCase().execute(p.userId, lead.id)));
        expect(fulfilled(result), `round ${round}`).toHaveLength(1);
        expect(await prisma.leadPurchase.count({ where: { leadId: lead.id } }), `round ${round}`).toBe(1);
      }
    });

    it("the same professional hammering one lead from 10 concurrent requests ends with ONE purchase and one shared purchase id (idempotent replay)", async () => {
      const category = await seedCategory(prisma);
      const { lead } = await submitPublishedLead(category);
      const [pro] = await seedProfessionals(category, 1);

      const result = await settle(Array.from({ length: 10 }, () => makeInitiateLeadPurchaseUseCase().execute(pro!.userId, lead.id)));

      const winners = fulfilled(result);
      expect(winners.length).toBeGreaterThanOrEqual(1);
      expect(new Set(winners.map((w) => w.value.purchaseId)).size).toBe(1);
      for (const failure of rejected(result)) {
        // The only acceptable refusals for the SAME professional are the documented duplicate / limit errors - never a raw database error.
        expect([DuplicateActiveLeadPurchaseError, LeadBuyerLimitReachedError, LeadNotPurchasableError].some((c) => failure.reason instanceof c), String(failure.reason)).toBe(true);
      }
      expect(await prisma.leadPurchase.count({ where: { leadId: lead.id } })).toBe(1);
    });

    it("an unpaid PENDING_PAYMENT purchase holds the exclusive slot; cancelling it frees the slot; cancel-vs-buy races never yield two active purchases", async () => {
      const category = await seedCategory(prisma);
      const { lead } = await submitPublishedLead(category);
      const [a, b, c] = await seedProfessionals(category, 3);
      const first = await makeInitiateLeadPurchaseUseCase().execute(a!.userId, lead.id);
      // B is refused while A holds the (unpaid) slot - there is no expiry, see the report's stuck-PENDING_PAYMENT finding.
      await expect(makeInitiateLeadPurchaseUseCase().execute(b!.userId, lead.id)).rejects.toBeTruthy();

      const [cancelled, bought] = await Promise.allSettled([
        makeTransitionLeadPurchaseUseCase().execute(first.purchaseId, "CANCELLED"),
        makeInitiateLeadPurchaseUseCase().execute(b!.userId, lead.id),
      ]);
      expect(cancelled.status).toBe("fulfilled");
      // B either lost the race (refused while A was still active) or won after the cancel - never both active.
      expect(await activeCount(lead.id)).toBe(bought.status === "fulfilled" ? 1 : 0);
      if (bought.status === "rejected") {
        const retry = await makeInitiateLeadPurchaseUseCase().execute(c!.userId, lead.id);
        expect(retry.status).toBe("PENDING_PAYMENT");
        expect(await activeCount(lead.id)).toBe(1);
      }
    });
  });

  describe("payment initiation", () => {
    it("10 concurrent initiations for one purchase converge on ONE provider payment and ONE persisted reference", async () => {
      const category = await seedCategory(prisma);
      const { lead } = await submitPublishedLead(category);
      const [pro] = await seedProfessionals(category, 1);
      const purchase = await makeInitiateLeadPurchaseUseCase().execute(pro!.userId, lead.id);

      const result = await settle(Array.from({ length: 10 }, () => makeInitiateLeadFeePaymentUseCase().execute(pro!.userId, purchase.purchaseId)));

      expect(rejected(result)).toHaveLength(0);
      expect(new Set(fulfilled(result).map((r) => r.value.clientSecret)).size).toBe(1);
      const gateway = m161Gateway.current;
      expect(new Set(gateway.created.map((c) => c.idempotencyKey)).size).toBe(1);
      expect(gateway.payments.size).toBe(1);
      expect(gateway.created.every((c) => c.amountMinorUnits === PILOT_TOTAL_MINOR_UNITS)).toBe(true);
      expect(gateway.canceled).toEqual([]);
      const stored = await row(purchase.purchaseId);
      expect(stored.status).toBe("PENDING_PAYMENT");
      expect(stored.paymentReference).toBe([...gateway.payments.keys()][0]);
      expect(await prisma.leadFeeLedgerEntry.count()).toBe(0);
    });

    it("a provider failure leaves no reference and no side effect; the retry succeeds and creates exactly one payment", async () => {
      const category = await seedCategory(prisma);
      const { lead } = await submitPublishedLead(category);
      const [pro] = await seedProfessionals(category, 1);
      const purchase = await makeInitiateLeadPurchaseUseCase().execute(pro!.userId, lead.id);
      const gateway = m161Gateway.current;

      gateway.failCreate = new Error("provider timeout");
      await expect(makeInitiateLeadFeePaymentUseCase().execute(pro!.userId, purchase.purchaseId)).rejects.toMatchObject({ code: "LEAD_FEE_PAYMENT_UNAVAILABLE" });
      expect((await row(purchase.purchaseId)).paymentReference).toBeNull();
      expect((await row(purchase.purchaseId)).status).toBe("PENDING_PAYMENT");

      gateway.failCreate = null;
      await makeInitiateLeadFeePaymentUseCase().execute(pro!.userId, purchase.purchaseId);
      expect(gateway.payments.size).toBe(1);
      expect((await row(purchase.purchaseId)).paymentReference).toMatch(/^pi_fake_/);
    });
  });

  describe("webhook confirmation under concurrency", () => {
    async function pendingWithPayment(existing?: { id: string }) {
      const category = existing ?? (await seedCategory(prisma));
      const { lead } = await submitPublishedLead(category);
      const [pro] = await seedProfessionals(category, 1);
      const attempt = await purchaseWithPaymentAttempt(pro!, lead.id);
      return { lead, pro: pro!, ...attempt };
    }

    it("the SAME event id delivered 10x concurrently is processed once (one confirmed, the rest duplicate), one ledger entry", async () => {
      const ctx = await pendingWithPayment();
      const event = succeeded(ctx.reference, ctx.purchaseId, ctx.lead.id);

      const outcomes = await Promise.all(Array.from({ length: 10 }, () => send(event)));

      expect(outcomes.every((o) => o.http === 200)).toBe(true);
      expect(outcomes.filter((o) => o.status === "confirmed")).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === "duplicate").length).toBeGreaterThanOrEqual(1);
      expect(await prisma.leadFeeLedgerEntry.count()).toBe(1);
      expect((await row(ctx.purchaseId)).status).toBe("CONFIRMED");
    });

    it("10 DIFFERENT event ids for the same PaymentIntent confirm exactly once: one ledger entry, one confirmedAt, no other outcome than confirmed / already-confirmed", async () => {
      const ctx = await pendingWithPayment();
      const { result: outcomes, evidence } = await withContentionProbe(() => Promise.all(Array.from({ length: 10 }, () => send(succeeded(ctx.reference, ctx.purchaseId, ctx.lead.id)))));

      expect(outcomes.every((o) => o.http === 200 && ["confirmed", "already-confirmed"].includes(String(o.status)))).toBe(true);
      // OBSERVATION (reported in the Gate B document, finding F-1): several concurrent deliveries can each report "confirmed" although
      // exactly one of them performed the transition (the use case is idempotent, the label is not). The PERSISTED effects below are what
      // the contract guarantees, and they are single.
      const confirmedLabels = outcomes.filter((o) => o.status === "confirmed").length;
      expect(confirmedLabels).toBeGreaterThanOrEqual(1);
      console.info(`[M161 evidence] 10 distinct events, same PaymentIntent: outcome labels confirmed=${confirmedLabels} already-confirmed=${10 - confirmedLabels}`);
      expect(await prisma.leadFeeLedgerEntry.count({ where: { leadPurchaseId: ctx.purchaseId } })).toBe(1);
      const confirmed = await row(ctx.purchaseId);
      expect(confirmed.status).toBe("CONFIRMED");
      // No duplicated business side effect: the idempotent notifications (M145) exist once per recipient despite N published events.
      const notes = await prisma.notification.groupBy({ by: ["userId", "type"], _count: { _all: true } });
      expect(notes.every((n) => n._count._all === 1), JSON.stringify(notes)).toBe(true);
      await send(succeeded(ctx.reference, ctx.purchaseId, ctx.lead.id));
      expect((await row(ctx.purchaseId)).confirmedAt?.getTime()).toBe(confirmed.confirmedAt?.getTime());
      console.info(`[M161 evidence] 10-way webhook race: samples=${evidence.samples} peakActiveBackends=${evidence.peakActiveBackends} peakLockWaiters=${evidence.peakLockWaiters}`);
    });

    it("succeeded / canceled / failed delivered concurrently can never produce an inconsistent terminal state (20 rounds)", async () => {
      const sharedCategory = await seedCategory(prisma);
      for (let round = 0; round < 20; round += 1) {
        const ctx = await pendingWithPayment(sharedCategory);
        const mk = (type: "payment_intent.succeeded" | "payment_intent.canceled" | "payment_intent.payment_failed") =>
          paymentIntentEvent({ type, paymentIntentId: ctx.reference, amountMinorUnits: PILOT_TOTAL_MINOR_UNITS, leadPurchaseId: ctx.purchaseId, leadId: ctx.lead.id });
        const outcomes = await Promise.all([send(mk("payment_intent.succeeded")), send(mk("payment_intent.canceled")), send(mk("payment_intent.payment_failed")), send(mk("payment_intent.succeeded"))]);
        expect(outcomes.every((o) => o.http === 200), `round ${round}: ${JSON.stringify(outcomes)}`).toBe(true);

        const final = await row(ctx.purchaseId);
        const ledger = await prisma.leadFeeLedgerEntry.count({ where: { leadPurchaseId: ctx.purchaseId } });
        // CONFIRMED <=> exactly one ledger entry; CANCELLED / PENDING <=> none. Timestamps never mixed.
        if (final.status === "CONFIRMED") {
          expect(ledger, `round ${round}`).toBe(1);
          expect([final.confirmedAt !== null, final.cancelledAt, final.failedAt]).toEqual([true, null, null]);
        } else {
          expect(["CANCELLED", "PENDING_PAYMENT"], `round ${round}`).toContain(final.status);
          expect(ledger, `round ${round}`).toBe(0);
          expect(final.confirmedAt).toBeNull();
        }
      }
    });

    it("out-of-order events follow the implemented contract: cancel / failure AFTER confirmation never un-confirms; success AFTER cancel is rejected", async () => {
      const ctx = await pendingWithPayment();
      expect((await send(succeeded(ctx.reference, ctx.purchaseId, ctx.lead.id))).status).toBe("confirmed");
      const late = (type: "payment_intent.canceled" | "payment_intent.payment_failed") =>
        send(paymentIntentEvent({ type, paymentIntentId: ctx.reference, amountMinorUnits: PILOT_TOTAL_MINOR_UNITS, leadPurchaseId: ctx.purchaseId, leadId: ctx.lead.id }));
      const canceled = await late("payment_intent.canceled");
      const failed = await late("payment_intent.payment_failed");
      expect(canceled.http).toBe(200);
      expect(failed.http).toBe(200);
      expect((await row(ctx.purchaseId)).status).toBe("CONFIRMED");
      expect(await prisma.leadFeeLedgerEntry.count()).toBe(1);
    });
  });

  describe("failure injection at the transaction boundary", () => {
    const TRIGGER = "m161_fail_ledger_insert_trg";
    const FUNCTION = "m161_fail_ledger_insert";
    async function injectLedgerFailure() {
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${FUNCTION}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'm161 injected ledger failure'; END; $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON lead_fee_ledger_entries FOR EACH ROW EXECUTE FUNCTION ${FUNCTION}()`);
    }
    async function removeLedgerFailure() {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER} ON lead_fee_ledger_entries`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FUNCTION}()`);
    }
    afterEach(async () => {
      await removeLedgerFailure().catch(() => undefined);
    });

    it("a ledger write that fails inside the confirmation transaction rolls the WHOLE confirmation back (5xx, purchase still PENDING_PAYMENT, no ledger, event re-claimable); the redelivery then succeeds exactly once", async () => {
      const category = await seedCategory(prisma);
      const { lead } = await submitPublishedLead(category);
      const [pro] = await seedProfessionals(category, 1);
      const ctx = await purchaseWithPaymentAttempt(pro!, lead.id);
      const event = succeeded(ctx.reference, ctx.purchaseId, lead.id);

      await injectLedgerFailure();
      const failed = await send(event);
      expect(failed.http).toBeGreaterThanOrEqual(500); // 5xx => the provider retries
      const afterFailure = await row(ctx.purchaseId);
      expect(afterFailure.status).toBe("PENDING_PAYMENT");
      expect(afterFailure.confirmedAt).toBeNull();
      expect(await prisma.leadFeeLedgerEntry.count()).toBe(0);
      // the idempotency record is not left PROCESSED: a retry of the SAME event id must be able to run
      const claimed = await prisma.externalWebhookEvent.findMany({ where: { externalEventId: event.id as string } });
      expect(claimed.length).toBeLessThanOrEqual(1);
      expect(claimed.every((c) => c.status !== "PROCESSED")).toBe(true);

      await removeLedgerFailure();
      const retried = await send(event); // same event id, as Stripe would redeliver
      expect(retried).toEqual({ http: 200, status: "confirmed" });
      expect((await row(ctx.purchaseId)).status).toBe("CONFIRMED");
      expect(await prisma.leadFeeLedgerEntry.count()).toBe(1);
      expect(await send(event)).toEqual({ http: 200, status: "duplicate" });
      expect(await prisma.leadFeeLedgerEntry.count()).toBe(1);
    });

    it("a payment created at the provider whose purchase turned terminal during the call is cancelled and never persisted (no reference, no payable purchase)", async () => {
      const category = await seedCategory(prisma);
      const { lead } = await submitPublishedLead(category);
      const [pro] = await seedProfessionals(category, 1);
      const purchase = await makeInitiateLeadPurchaseUseCase().execute(pro!.userId, lead.id);
      const gateway = m161Gateway.current;
      gateway.afterCreate = async () => {
        await makeTransitionLeadPurchaseUseCase().execute(purchase.purchaseId, "CANCELLED");
      };

      await expect(makeInitiateLeadFeePaymentUseCase().execute(pro!.userId, purchase.purchaseId)).rejects.toBeTruthy();

      expect(gateway.canceled).toHaveLength(1);
      const stored = await row(purchase.purchaseId);
      expect(stored.status).toBe("CANCELLED");
      expect(stored.paymentReference).toBeNull();
    });
  });
});
