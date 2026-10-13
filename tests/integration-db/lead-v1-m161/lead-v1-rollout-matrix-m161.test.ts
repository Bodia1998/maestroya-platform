/**
 * Module 161 — M159 rollout modes verified against the REAL composition roots AND the real database.
 *
 * For every supported mode (DISABLED, ENTRY_ONLY, PURCHASE_ONLY, ENABLED) and every failing configuration (unset, empty, wrong
 * case, padded, alias, garbage) the same world is probed:
 *   - NEW-activity operations (customer submit / create / publish; professional feed, list, purchase, payment initiation) are
 *     allowed or refused exactly as the M159 table says, and a REFUSED call leaves no row, no provider call and no consent
 *     evidence behind;
 *   - the operations that must NEVER depend on the switch (webhook confirmation and its idempotency, confirmed-buyer contact access,
 *     checkout read, single preview, quality claims, dispute webhook, refunds, revocation, consent withdrawal, retention job,
 *     admin console) keep working in every mode;
 *   - a LEAD_V1 payment can never be confirmed through the legacy customer-payment path.
 *
 * The expected table below is written out by hand from docs/MODULE_159_ROLLOUT_CONTROLS.md section 4 - it is deliberately NOT
 * computed by calling the implementation under test.
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
import { makeGetLeadContactUseCase } from "@/application/use-cases/lead-contact/compose";
import { makeListAdminLeadsUseCase } from "@/application/use-cases/lead-admin-console/compose";
import { makeLeadFeeDisputeReconciler, makeRevokeLeadPurchaseUseCase } from "@/application/use-cases/lead-fee-dispute/compose";
import { makeInitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/compose";
import { makeExecuteLeadFeeRefundUseCase } from "@/application/use-cases/lead-fee-refund/compose";
import { makeGetLeadPurchaseCheckoutUseCase } from "@/application/use-cases/lead-checkout/compose";
import { makeCreateLeadV1ServiceRequestUseCase, makeGetLeadFeedForProfessionalUseCase, makeGetPublishedLeadPreviewUseCase, makeGetPublishedLeadPreviewsForProfessionalUseCase, makePublishLeadUseCase } from "@/application/use-cases/lead/compose";
import { makeRunLeadPrivacyRetentionUseCase, makeWithdrawLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/compose";
import { makeInitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";
import { makeSubmitLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/compose";
import { makeSubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/compose";
import { getLeadRolloutStatus } from "@/application/use-cases/lead-rollout/compose";
import { LeadV1RolloutDisabledError } from "@/domain/services/lead-rollout";
import { prisma } from "@/infrastructure/database/prisma/client";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { PILOT_PRICING, PILOT_TOTAL_MINOR_UNITS, purchaseWithPaymentAttempt, submitPublishedLead } from "../../test-utils/m161-lead-v1-flows";
import {
  REQUEST_INPUT,
  disputeEvent,
  m161Gateway,
  paymentIntentEvent,
  resetM161Gateway,
  seedAdmin,
  seedCategory,
  seedCustomer,
  seedProfessional,
  signedWebhookRequest,
  webhookOutcome,
} from "../../test-utils/m161-lead-v1-world";

type Expectation = { entry: boolean; purchase: boolean };
const DISABLED: Expectation = { entry: false, purchase: false };

/** [value of LEAD_V1_ROLLOUT_MODE (undefined = variable absent), expected areas, label] - hand-written from M159 section 3 and 4. */
const SETTINGS: Array<[string | undefined, Expectation, string]> = [
  [undefined, DISABLED, "unset (default)"],
  ["", DISABLED, "empty"],
  ["DISABLED", DISABLED, "DISABLED"],
  ["ENTRY_ONLY", { entry: true, purchase: false }, "ENTRY_ONLY"],
  ["PURCHASE_ONLY", { entry: false, purchase: true }, "PURCHASE_ONLY"],
  ["ENABLED", { entry: true, purchase: true }, "ENABLED"],
  ["enabled", DISABLED, "wrong case"],
  [" ENABLED", DISABLED, "padded"],
  ["true", DISABLED, "alias 'true'"],
  ["1", DISABLED, "alias '1'"],
  ["ENABLED;DROP", DISABLED, "garbage"],
];

const setMode = (value: string | undefined) => {
  if (value === undefined) delete process.env.LEAD_V1_ROLLOUT_MODE;
  else process.env.LEAD_V1_ROLLOUT_MODE = value;
};

describe("Module 161 — rollout modes on the real composition roots (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const saved = { rollout: process.env.LEAD_V1_ROLLOUT_MODE, abuse: process.env.LEAD_ABUSE_CONTROL_MODE, basis: process.env.LEAD_CONTACT_SHARING_BASIS, refund: process.env.LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED };
  beforeEach(() => {
    delete process.env.LEAD_ABUSE_CONTROL_MODE;
    delete process.env.LEAD_CONTACT_SHARING_BASIS;
    process.env.LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED = "true";
    resetM161Gateway();
  });
  afterEach(() => {
    for (const [key, value] of [["LEAD_V1_ROLLOUT_MODE", saved.rollout], ["LEAD_ABUSE_CONTROL_MODE", saved.abuse], ["LEAD_CONTACT_SHARING_BASIS", saved.basis], ["LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED", saved.refund]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const outcome = async (p: Promise<unknown>): Promise<"OK" | "ROLLOUT_REFUSED" | { other: string }> => {
    try {
      await p;
      return "OK";
    } catch (error) {
      if (error instanceof LeadV1RolloutDisabledError) return "ROLLOUT_REFUSED";
      return { other: error instanceof Error ? error.constructor.name : "unknown" };
    }
  };
  const allowedOrRefused = (area: boolean) => (area ? "OK" : "ROLLOUT_REFUSED");
  const row = (id: string) => prisma.leadPurchase.findUniqueOrThrow({ where: { id } });
  const counts = async () => ({
    requests: await prisma.serviceRequest.count(),
    leads: await prisma.lead.count(),
    addresses: await prisma.address.count(),
    purchases: await prisma.leadPurchase.count(),
    consent: await prisma.leadContactSharingRecord.count(),
    providerCalls: m161Gateway.current.created.length,
  });

  /** Everything the probes need, built while the switch is fully ENABLED, BEFORE the mode under test is applied. */
  async function buildWorld() {
    setMode("ENABLED");
    const category = await seedCategory(prisma);
    const admin = await seedAdmin(prisma);
    const buyer = await seedProfessional(prisma, { categoryId: category.id });
    const shopper = await seedProfessional(prisma, { categoryId: category.id }); // will try to start NEW purchases
    const feedOwner = await seedProfessional(prisma, { categoryId: category.id });

    // lead A: open for new purchases (shopper tries it); lead B: pending purchase WITHOUT a payment attempt (payment-initiation probe)
    const open = await submitPublishedLead(category);
    const forPaymentInit = await submitPublishedLead(category);
    const pendingNoPayment = await makeInitiateLeadPurchaseUseCase().execute(buyer.userId, forPaymentInit.lead.id);
    // lead C: purchase with a payment attempt, NOT yet confirmed (the webhook probe)
    const unpaid = await submitPublishedLead(category);
    const unpaidPurchase = await purchaseWithPaymentAttempt(buyer, unpaid.lead.id);
    // lead D/E: CONFIRMED purchases (contact / checkout / claim / dispute / refund / revoke probes)
    const confirmedOne = await confirmed(buyer, category);
    const confirmedTwo = await confirmed(buyer, category);
    // a DRAFT lead waiting for publication (ENTRY probe: publish)
    const draftCustomer = await seedCustomer(prisma);
    const draft = await makeCreateLeadV1ServiceRequestUseCase().execute(draftCustomer.userId, REQUEST_INPUT(category.id));
    // a customer for a NEW request (ENTRY probe: submit)
    const newCustomer = await seedCustomer(prisma);
    return { category, admin, buyer, shopper, feedOwner, open, pendingNoPayment, forPaymentInit, unpaid, unpaidPurchase, confirmedOne, confirmedTwo, draft, draftCustomer, newCustomer };
  }

  async function confirmed(buyer: { userId: string; profileId: string }, category: { id: string }) {
    const { customer, lead } = await submitPublishedLead(category);
    const attempt = await purchaseWithPaymentAttempt(buyer as never, lead.id);
    const res = await webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent({ paymentIntentId: attempt.reference, amountMinorUnits: PILOT_TOTAL_MINOR_UNITS, leadPurchaseId: attempt.purchaseId, leadId: lead.id }))));
    expect(res).toEqual({ http: 200, status: "confirmed" });
    const issued = m161Gateway.current.payments.get(attempt.reference)!;
    m161Gateway.current.payments.set(attempt.reference, { ...issued, status: "SUCCEEDED" });
    return { customer, lead, ...attempt };
  }

  it.each(SETTINGS)("LEAD_V1_ROLLOUT_MODE=%j (%s): new activity follows the M159 table", async (setting, expected) => {
    const w = await buildWorld();
    setMode(setting);

    // The admin banner / status view agrees with the table (effective mode shown, never throws).
    const status = getLeadRolloutStatus();
    expect({ entry: status.entryOpen, purchase: status.purchaseOpen }).toEqual(expected);

    // ---- ENTRY area (customers)
    const before = await counts();
    const submitted = await outcome(makeSubmitLeadRequestUseCase(PILOT_PRICING()).execute(w.newCustomer.userId, REQUEST_INPUT(w.category.id)));
    expect(submitted, "submit lead request").toBe(allowedOrRefused(expected.entry));
    const createdV1 = await outcome(makeCreateLeadV1ServiceRequestUseCase().execute(w.newCustomer.userId, REQUEST_INPUT(w.category.id)));
    expect(createdV1, "create LEAD_V1 service request").toBe(allowedOrRefused(expected.entry));
    const published = await outcome(makePublishLeadUseCase(PILOT_PRICING()).execute(w.draftCustomer.userId, w.draft.lead.id));
    expect(published, "publish lead").toBe(allowedOrRefused(expected.entry));
    const afterEntry = await counts();
    if (!expected.entry) {
      // a refused ENTRY call reads/writes nothing: no request, no lead, no address, no consent evidence
      expect(afterEntry).toEqual(before);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: w.draft.lead.id } })).status).toBe("DRAFT");
    } else {
      expect(afterEntry.requests).toBe(before.requests + 2);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: w.draft.lead.id } })).status).toBe("PUBLISHED");
    }

    // ---- PURCHASE area (professionals)
    const beforePurchase = await counts();
    expect(await outcome(makeGetLeadFeedForProfessionalUseCase().execute(w.feedOwner.userId)), "marketplace feed").toBe(allowedOrRefused(expected.purchase));
    expect(await outcome(makeGetPublishedLeadPreviewsForProfessionalUseCase().execute(w.feedOwner.userId)), "published-lead list").toBe(allowedOrRefused(expected.purchase));
    expect(await outcome(makeInitiateLeadPurchaseUseCase().execute(w.shopper.userId, w.open.lead.id)), "initiate purchase").toBe(allowedOrRefused(expected.purchase));
    expect(await outcome(makeInitiateLeadFeePaymentUseCase().execute(w.buyer.userId, w.pendingNoPayment.purchaseId)), "initiate lead-fee payment").toBe(allowedOrRefused(expected.purchase));
    const afterPurchase = await counts();
    if (!expected.purchase) {
      expect(afterPurchase).toEqual(beforePurchase); // no purchase row, no provider call
      expect((await row(w.pendingNoPayment.purchaseId)).paymentReference).toBeNull();
    } else {
      expect(afterPurchase.purchases).toBe(beforePurchase.purchases + 1);
      expect(afterPurchase.providerCalls).toBe(beforePurchase.providerCalls + 1);
    }
  });

  it.each(SETTINGS)("LEAD_V1_ROLLOUT_MODE=%j (%s): paid purchases, access, refunds, disputes, consent, retention and admin never depend on the switch", async (setting) => {
    const w = await buildWorld();
    setMode(setting);

    // Webhook confirmation of an already-created payment, and its idempotency (never stranded).
    const event = paymentIntentEvent({ paymentIntentId: w.unpaidPurchase.reference, amountMinorUnits: PILOT_TOTAL_MINOR_UNITS, leadPurchaseId: w.unpaidPurchase.purchaseId, leadId: w.unpaid.lead.id });
    expect(await webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(event)))).toEqual({ http: 200, status: "confirmed" });
    expect(await webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(event)))).toEqual({ http: 200, status: "duplicate" });
    expect((await row(w.unpaidPurchase.purchaseId)).status).toBe("CONFIRMED");
    expect(await prisma.leadFeeLedgerEntry.count({ where: { leadPurchaseId: w.unpaidPurchase.purchaseId } })).toBe(1);

    // Confirmed-buyer contact access, own-purchase checkout read, single-lead preview.
    expect((await makeGetLeadContactUseCase().execute(w.buyer.userId, w.confirmedOne.lead.id)).email).toBe(w.confirmedOne.customer.email);
    expect(await outcome(makeGetLeadPurchaseCheckoutUseCase().execute(w.buyer.userId, w.confirmedOne.lead.id)), "checkout read").toBe("OK");
    expect(await outcome(makeGetPublishedLeadPreviewUseCase().execute(w.shopper.userId, w.open.lead.id)), "single preview").toBe("OK");

    // Quality claim (M154) is not a rollout area.
    expect(await outcome(makeSubmitLeadQualityClaimUseCase().execute(w.buyer.userId, { leadPurchaseId: w.confirmedOne.purchaseId, reasonCode: "CONTACT_UNREACHABLE", description: "The phone number never answers." })), "claim").toBe("OK");

    // Dispute webhook (M155): suspends, and a won dispute restores - in every mode.
    const dispute = async (type: "charge.dispute.created" | "charge.dispute.closed", status: string) =>
      webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(disputeEvent({ type, disputeId: "dp_m161_rollout", paymentIntentId: w.confirmedOne.reference, amountMinorUnits: PILOT_TOTAL_MINOR_UNITS, status }))));
    expect((await dispute("charge.dispute.created", "needs_response")).http).toBe(200);
    expect((await row(w.confirmedOne.purchaseId)).status).toBe("DISPUTED");
    expect((await dispute("charge.dispute.closed", "won")).http).toBe(200);
    expect((await row(w.confirmedOne.purchaseId)).status).toBe("CONFIRMED");
    expect(await outcome(makeLeadFeeDisputeReconciler().reconcile(w.confirmedOne.purchaseId)), "dispute reconciler").toBe("OK");

    // Revocation of purchase two (M155) and refund of purchase one (M153).
    expect((await makeRevokeLeadPurchaseUseCase().execute({ actorUserId: w.admin, leadPurchaseId: w.confirmedTwo.purchaseId, explanation: "Abuse confirmed.", evidenceReference: "INC-M161-R" })).revoked).toBe(true);
    await makeExecuteLeadFeeRefundUseCase().execute({ actorUserId: w.admin, leadPurchaseId: w.confirmedOne.purchaseId, reasonCode: "PLATFORM_ERROR", explanation: "Platform defect.", evidenceReference: "INC-M161-F" });
    expect((await row(w.confirmedOne.purchaseId)).status).toBe("REFUNDED");

    // Consent withdrawal and the retention job (M158), admin console (M157): none is refused by the rollout switch.
    expect(await outcome(makeWithdrawLeadContactSharingUseCase().execute(w.confirmedTwo.customer.userId, w.confirmedTwo.lead.id)), "consent withdrawal").not.toBe("ROLLOUT_REFUSED");
    expect(await outcome(makeRunLeadPrivacyRetentionUseCase().execute({ batchSize: 5, dryRun: true })), "retention job").not.toBe("ROLLOUT_REFUSED");
    expect(await outcome(makeListAdminLeadsUseCase().execute(w.admin)), "admin console").toBe("OK");
  });

  describe("legacy boundary (M121 / M131) holds in every mode", () => {
    it.each(SETTINGS)("LEAD_V1_ROLLOUT_MODE=%j (%s): a lead-fee PaymentIntent never reaches the legacy customer-payment path", async (setting) => {
      const w = await buildWorld();
      setMode(setting);
      const reference = w.unpaidPurchase.reference;

      // 1. The same PaymentIntent WITHOUT the LEAD_V1 marker is a "legacy-shaped" event: it must not confirm the LEAD_V1 purchase.
      const legacyShaped = paymentIntentEvent({ paymentIntentId: reference, amountMinorUnits: PILOT_TOTAL_MINOR_UNITS });
      (legacyShaped.data.object as { metadata: Record<string, string> }).metadata = {};
      await stripePaymentsWebhook(signedWebhookRequest(legacyShaped));
      expect((await row(w.unpaidPurchase.purchaseId)).status).toBe("PENDING_PAYMENT");
      expect(await prisma.leadFeeLedgerEntry.count()).toBe(2); // only the two purchases confirmed while building the world - none from this event

      // 2. LEAD_V1 operations create no legacy money rows in any mode.
      expect({ payments: await prisma.payment.count(), commissions: await prisma.commission.count(), payouts: await prisma.payout.count(), quotes: await prisma.quote.count() }).toEqual({ payments: 0, commissions: 0, payouts: 0, quotes: 0 });
    });
  });
});
