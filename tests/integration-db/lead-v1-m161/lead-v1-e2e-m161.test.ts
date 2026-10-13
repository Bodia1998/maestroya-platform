/**
 * Module 161 — LEAD_V1 end-to-end verification against REAL PostgreSQL.
 *
 * WHAT IS EXECUTED END TO END (real code, real database, no mocks of project code):
 *   customer submit (real `makeSubmitLeadRequestUseCase` with the released M132 pilot pricing snapshot, real static geocoder)
 *   -> request validation + category policy -> price estimate (M129) + pricing (M128/M132) + publication (M133, pilot buyer policy)
 *   -> professional marketplace feed (M134) -> purchase initiation (M126/M135/M147) -> lead-fee payment initiation (M140)
 *   -> the REAL `/api/webhooks/stripe-payments` route handler with a locally signed event (real HMAC verification, real verifier,
 *      real lead-fee webhook use case, real idempotency claim) -> CONFIRMED + atomic revenue-ledger entry (M141/M149)
 *   -> contact access for the confirmed buyer and denial for everybody else (M138) -> invoice issuance (M150)
 *   -> refund (M153), dispute / revocation (M155) and consent withdrawal (M158) consequences on contact access.
 *
 * WHAT IS SIMULATED: only the payment PROVIDER (`FakeLeadFeePaymentGateway`, the project's M140/M153 in-memory double) - no Stripe
 * network call, no real money - and the e-mail transport (never used). The webhook payload is a hand-built Stripe-shaped JSON
 * signed with the configured TEST secret; real Stripe would deliver the same shape, but this suite does not prove that Stripe does.
 *
 * WHAT IS NOT EXECUTED HERE: the Next.js HTTP server / Server Actions / session layer (`requireRole`), a real Stripe test-mode
 * account, real e-mail delivery. See docs/MODULE_161_E2E_CONCURRENCY_LOAD_VERIFICATION.md section 10.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// The ONLY simulated project collaborator: the Stripe lead-fee gateway adapter resolves to the in-memory provider.
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
// Never send mail: the transport is replaced by a recorder.
vi.mock("@/infrastructure/email/resend-email-sender", () => ({
  ResendEmailSender: class {
    async send(): Promise<void> {}
  },
}));

import { POST as stripePaymentsWebhook } from "@/app/api/webhooks/stripe-payments/route";
import { makeGetLeadContactUseCase } from "@/application/use-cases/lead-contact/compose";
import { makeIssueLeadFeeInvoiceUseCase } from "@/application/use-cases/lead-fee-invoice/compose";
import { makeInitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/compose";
import { makeExecuteLeadFeeRefundUseCase } from "@/application/use-cases/lead-fee-refund/compose";
import { makeRevokeLeadPurchaseUseCase } from "@/application/use-cases/lead-fee-dispute/compose";
import { makeGetLeadFeedForProfessionalUseCase } from "@/application/use-cases/lead/compose";
import { makeInitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";
import { makeWithdrawLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/compose";
import { makeSubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/compose";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";
import { DuplicateActiveLeadPurchaseError, LeadBuyerLimitReachedError, LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import { LeadFeePaymentNotInitiableError } from "@/domain/services/lead-fee-payment";
import { prisma } from "@/infrastructure/database/prisma/client";
import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";

import { assertNoContactLeak } from "../../test-utils/contact-leak-sentinels";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
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

const PRICING = () => resolveLeadPricingProductionConfig("lead-pricing-pilot-v1");

const ENV_KEYS = [
  "LEAD_V1_ROLLOUT_MODE",
  "LEAD_ABUSE_CONTROL_MODE",
  "LEAD_CONTACT_SHARING_BASIS",
  "LEAD_CONTACT_SHARING_NOTICE_VERSION",
  "LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED",
  "MAESTROYA_ISSUER_LEGAL_NAME",
  "MAESTROYA_ISSUER_TAX_ID",
  "MAESTROYA_ISSUER_ADDRESS",
  "LEAD_FEE_INVOICE_POLICY_APPROVAL_REF",
] as const;

describe("Module 161 — LEAD_V1 end to end (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.LEAD_V1_ROLLOUT_MODE = "ENABLED";
    resetM161Gateway();
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  /** Customer submits -> published lead. Returns everything later steps need. */
  async function publishedLead(existingCategory?: { id: string }) {
    const category = existingCategory ?? (await seedCategory(prisma, "fontaneria"));
    const customer = await seedCustomer(prisma);
    const submitted = await makeSubmitLeadRequestUseCase(PRICING()).execute(customer.userId, REQUEST_INPUT(category.id));
    const lead = await prisma.lead.findFirstOrThrow({ where: { serviceRequestId: submitted.receipt.requestId } });
    return { category, customer, submitted, lead };
  }

  async function confirmedPurchase() {
    const ctx = await publishedLead();
    const buyer = await seedProfessional(prisma, { categoryId: ctx.category.id });
    const purchase = await makeInitiateLeadPurchaseUseCase().execute(buyer.userId, ctx.lead.id);
    await makeInitiateLeadFeePaymentUseCase().execute(buyer.userId, purchase.purchaseId);
    const reference = (await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.purchaseId } })).paymentReference!;
    const res = await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent({ paymentIntentId: reference, amountMinorUnits: 2178, leadPurchaseId: purchase.purchaseId, leadId: ctx.lead.id })));
    expect(await webhookOutcome(res)).toEqual({ http: 200, status: "confirmed" });
    // The simulated provider agrees with the webhook it "sent": the payment succeeded there too (needed by the refund's provider check).
    const issued = m161Gateway.current.payments.get(reference)!;
    m161Gateway.current.payments.set(reference, { ...issued, status: "SUCCEEDED" });
    return { ...ctx, buyer, purchase, reference };
  }

  const deny = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
  const purchaseRow = (id: string) => prisma.leadPurchase.findUniqueOrThrow({ where: { id } });
  const legacyMoneyRows = async () => ({ payments: await prisma.payment.count(), commissions: await prisma.commission.count(), payouts: await prisma.payout.count(), quotes: await prisma.quote.count() });

  it("[E2E] request -> estimate -> price -> publish -> feed -> purchase -> payment -> signed webhook -> CONFIRMED -> contact -> invoice", async () => {
    // 1-4. Customer request, validation, estimation, pricing, publication - through the real ENABLED composition root.
    const category = await seedCategory(prisma, "fontaneria");
    const customer = await seedCustomer(prisma);
    const outsiderCategory = await seedCategory(prisma, "pintura");
    const buyer = await seedProfessional(prisma, { categoryId: category.id });
    const otherPro = await seedProfessional(prisma, { categoryId: category.id });
    const wrongCategoryPro = await seedProfessional(prisma, { categoryId: outsiderCategory.id });
    const legacyBefore = await legacyMoneyRows();

    const submitted = await makeSubmitLeadRequestUseCase(PRICING()).execute(customer.userId, REQUEST_INPUT(category.id));
    expect(submitted.publication).toBe("PUBLISHED");
    expect(submitted.receipt.status).toBe("RECEIVED");
    assertNoContactLeak(submitted.receipt, [customer.email, customer.phone]);

    const request = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: submitted.receipt.requestId } });
    expect(request.flowVersion).toBe("LEAD_V1");
    const lead = await prisma.lead.findFirstOrThrow({ where: { serviceRequestId: request.id } });
    expect(lead.status).toBe("PUBLISHED");
    // fontaneria: typical value 150.00 x rate 0.12 = 18.00 EUR (within the 5.00..150.00 clamp); pilot buyer policy is exclusive.
    expect(String(lead.publicationPrice)).toBe("18");
    expect(lead.publicationCurrency).toBe("EUR");
    expect(lead.publicationPricingConfigVersion).toBe("lead-pricing-pilot-v1");
    expect(lead.maxBuyers).toBe(1);
    expect(lead.publicationBuyerPolicyVersion).toBe("lead-buyer-policy-pilot-v1");

    // 5. Professional marketplace feed: the eligible professional sees it, the wrong-category one and the customer do not.
    const feed = makeGetLeadFeedForProfessionalUseCase();
    const page = await feed.execute(buyer.userId);
    expect(page.items.map((i) => i.leadId)).toEqual([lead.id]);
    expect(() => assertNoContactLeak(page, [customer.email, customer.phone, customer.name])).not.toThrow();
    expect((await feed.execute(wrongCategoryPro.userId)).items).toEqual([]);
    expect((await feed.execute(customer.userId)).items).toEqual([]);

    // 6. Purchase initiation: snapshot fee 18.00 + 21% IVA = 21.78, PENDING_PAYMENT, no contact.
    const purchase = await makeInitiateLeadPurchaseUseCase().execute(buyer.userId, lead.id);
    expect(purchase).toMatchObject({ leadId: lead.id, status: "PENDING_PAYMENT", price: 18, taxAmount: "3.78", totalAmount: "21.78", currency: "EUR" });
    expect(await deny(makeGetLeadContactUseCase().execute(buyer.userId, lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);

    // 7. Payment initiation: the provider is asked for exactly the persisted total in minor units; the purchase stays PENDING_PAYMENT.
    const payment = await makeInitiateLeadFeePaymentUseCase().execute(buyer.userId, purchase.purchaseId);
    expect(payment.purchaseStatus).toBe("PENDING_PAYMENT");
    expect(m161GatewayCreated()).toHaveLength(1);
    expect(m161GatewayCreated()[0]).toMatchObject({ amountMinorUnits: 2178, currency: "EUR", leadPurchaseId: purchase.purchaseId });
    const pending = await purchaseRow(purchase.purchaseId);
    expect(pending.status).toBe("PENDING_PAYMENT");
    const reference = pending.paymentReference!;
    expect(reference).toMatch(/^pi_fake_/);
    expect(await prisma.leadFeeLedgerEntry.count()).toBe(0);

    // 8. A forged / unsigned / tampered webhook changes nothing.
    const forged = await webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent({ paymentIntentId: reference, amountMinorUnits: 2178, leadPurchaseId: purchase.purchaseId, leadId: lead.id }), { secret: "whsec_not_the_real_secret" })));
    expect(forged.http).toBe(401);
    const tampered = await webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent({ paymentIntentId: reference, amountMinorUnits: 2178 }), { tamper: true })));
    expect(tampered.http).toBe(401);
    expect((await purchaseRow(purchase.purchaseId)).status).toBe("PENDING_PAYMENT");

    // 8b. Successful confirmation through the real route.
    const event = paymentIntentEvent({ paymentIntentId: reference, amountMinorUnits: 2178, leadPurchaseId: purchase.purchaseId, leadId: lead.id });
    expect(await webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(event)))).toEqual({ http: 200, status: "confirmed" });

    // 9. Purchase state, ledger (written atomically with the transition), no legacy money rows.
    const confirmed = await purchaseRow(purchase.purchaseId);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    expect(confirmed.paymentReference).toBe(reference);
    expect(await prisma.leadFeeLedgerEntry.count()).toBe(1);
    const ledger = await prisma.leadFeeLedgerEntry.findFirstOrThrow();
    expect(ledger.leadPurchaseId).toBe(purchase.purchaseId);
    expect(await legacyMoneyRows()).toEqual(legacyBefore);

    // 10. Contact: the confirmed buyer gets it; the other (eligible) professional, the wrong-category one and the customer do not.
    const contact = await makeGetLeadContactUseCase().execute(buyer.userId, lead.id);
    expect(contact.email).toBe(customer.email);
    expect(await deny(makeGetLeadContactUseCase().execute(otherPro.userId, lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);
    expect(await deny(makeGetLeadContactUseCase().execute(wrongCategoryPro.userId, lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);
    expect(await deny(makeGetLeadContactUseCase().execute(customer.userId, lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);

    // 11a. Duplicate delivery of the same event id: acknowledged, nothing re-processed.
    expect(await webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(event)))).toEqual({ http: 200, status: "duplicate" });
    // 11b. A different event id for the same PaymentIntent: already confirmed, no second ledger entry, confirmedAt unmoved.
    const replay = paymentIntentEvent({ paymentIntentId: reference, amountMinorUnits: 2178, leadPurchaseId: purchase.purchaseId, leadId: lead.id });
    expect(await webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(replay)))).toEqual({ http: 200, status: "already-confirmed" });
    expect(await prisma.leadFeeLedgerEntry.count()).toBe(1);
    expect((await purchaseRow(purchase.purchaseId)).confirmedAt?.getTime()).toBe(confirmed.confirmedAt?.getTime());

    // 11c. The buyer cannot start a second payment or a second purchase; the exclusive lead is gone for everybody else.
    expect(await deny(makeInitiateLeadFeePaymentUseCase().execute(buyer.userId, purchase.purchaseId))).toBeInstanceOf(LeadFeePaymentNotInitiableError);
    expect(await deny(makeInitiateLeadPurchaseUseCase().execute(buyer.userId, lead.id))).toBeInstanceOf(DuplicateActiveLeadPurchaseError);
    const secondBuyer = await deny(makeInitiateLeadPurchaseUseCase().execute(otherPro.userId, lead.id));
    expect([LeadBuyerLimitReachedError, LeadNotPurchasableError].some((c) => secondBuyer instanceof c)).toBe(true);
    expect(await prisma.leadPurchase.count({ where: { leadId: lead.id, status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } } })).toBe(1);
    expect(m161GatewayCreated()).toHaveLength(1);

    // 12. Invoice (M150): trusted-internal use case. Fails closed without issuer configuration, issues once with it.
    expect(await deny(makeIssueLeadFeeInvoiceUseCase().execute(purchase.purchaseId))).toBeTruthy();
    expect(await prisma.leadFeeInvoice.count()).toBe(0);
    process.env.MAESTROYA_ISSUER_LEGAL_NAME = "M161 Test Issuer S.L.";
    process.env.MAESTROYA_ISSUER_TAX_ID = "B87654321";
    process.env.MAESTROYA_ISSUER_ADDRESS = "Calle Falsa 123, 28001 Madrid, ES";
    process.env.LEAD_FEE_INVOICE_POLICY_APPROVAL_REF = "M161-TEST-REF";
    const first = await makeIssueLeadFeeInvoiceUseCase().execute(purchase.purchaseId);
    const second = await makeIssueLeadFeeInvoiceUseCase().execute(purchase.purchaseId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(await prisma.leadFeeInvoice.count()).toBe(1);
    expect(await legacyMoneyRows()).toEqual(legacyBefore);
  });

  it("[E2E] failed payment leaves PENDING_PAYMENT and a retry still confirms exactly once; a cancelled payment never confirms", async () => {
    const ctx = await publishedLead();
    const buyer = await seedProfessional(prisma, { categoryId: ctx.category.id });
    const purchase = await makeInitiateLeadPurchaseUseCase().execute(buyer.userId, ctx.lead.id);
    await makeInitiateLeadFeePaymentUseCase().execute(buyer.userId, purchase.purchaseId);
    const reference = (await purchaseRow(purchase.purchaseId)).paymentReference!;
    const send = async (type: "payment_intent.succeeded" | "payment_intent.payment_failed" | "payment_intent.canceled") =>
      webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent({ type, paymentIntentId: reference, amountMinorUnits: 2178, leadPurchaseId: purchase.purchaseId, leadId: ctx.lead.id }))));

    expect(await send("payment_intent.payment_failed")).toEqual({ http: 200, status: "payment-failed-observed" });
    expect((await purchaseRow(purchase.purchaseId)).status).toBe("PENDING_PAYMENT");
    expect(await deny(makeGetLeadContactUseCase().execute(buyer.userId, ctx.lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);
    // the SAME payment attempt is reused on a payment-initiation retry (no second provider payment)
    await makeInitiateLeadFeePaymentUseCase().execute(buyer.userId, purchase.purchaseId);
    expect(m161GatewayCreated().map((c) => c.idempotencyKey).filter((k, i, a) => a.indexOf(k) === i)).toHaveLength(1);
    expect(await send("payment_intent.succeeded")).toEqual({ http: 200, status: "confirmed" });
    expect(await prisma.leadFeeLedgerEntry.count()).toBe(1);

    // cancelled path on a second lead
    const ctx2 = await publishedLead(ctx.category);
    const buyer2 = await seedProfessional(prisma, { categoryId: ctx2.category.id });
    const p2 = await makeInitiateLeadPurchaseUseCase().execute(buyer2.userId, ctx2.lead.id);
    await makeInitiateLeadFeePaymentUseCase().execute(buyer2.userId, p2.purchaseId);
    const ref2 = (await purchaseRow(p2.purchaseId)).paymentReference!;
    const send2 = async (type: "payment_intent.succeeded" | "payment_intent.canceled") =>
      webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent({ type, paymentIntentId: ref2, amountMinorUnits: 2178, leadPurchaseId: p2.purchaseId, leadId: ctx2.lead.id }))));
    expect(await send2("payment_intent.canceled")).toEqual({ http: 200, status: "cancelled" });
    expect((await send2("payment_intent.succeeded")).status).toBe("rejected");
    expect((await purchaseRow(p2.purchaseId)).status).toBe("CANCELLED");
    expect(await deny(makeGetLeadContactUseCase().execute(buyer2.userId, ctx2.lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);
  });

  it("[E2E] a wrong amount, a foreign PaymentIntent and an orphan payment are rejected / unmatched and confirm nothing", async () => {
    const ctx = await publishedLead();
    const buyer = await seedProfessional(prisma, { categoryId: ctx.category.id });
    const purchase = await makeInitiateLeadPurchaseUseCase().execute(buyer.userId, ctx.lead.id);
    await makeInitiateLeadFeePaymentUseCase().execute(buyer.userId, purchase.purchaseId);
    const reference = (await purchaseRow(purchase.purchaseId)).paymentReference!;
    const post = async (over: Partial<Parameters<typeof paymentIntentEvent>[0]>) =>
      webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent({ paymentIntentId: reference, amountMinorUnits: 2178, leadPurchaseId: purchase.purchaseId, leadId: ctx.lead.id, ...over }))));

    expect((await post({ amountMinorUnits: 2177 })).status).toBe("rejected");
    expect((await post({ currency: "usd" })).status).toBe("rejected");
    expect((await post({ paymentIntentId: "pi_somebody_else" })).status).toBe("unmatched");
    expect((await post({ leadPurchaseId: "00000000-0000-4000-8000-000000000000" })).status).toBe("rejected");
    expect((await purchaseRow(purchase.purchaseId)).status).toBe("PENDING_PAYMENT");
    expect(await prisma.leadFeeLedgerEntry.count()).toBe(0);
  });

  describe("consequences after confirmation keep their existing contracts", () => {
    it("[E2E] refund (M153): PLATFORM_ERROR refund -> REFUNDED, contact access ends, purchase history and ledger are kept", async () => {
      const ctx = await confirmedPurchase();
      const admin = await seedAdmin(prisma);
      process.env.LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED = "true";
      // The provider "knows" the payment (the simulated gateway issued it at initiation).
      const result = await makeExecuteLeadFeeRefundUseCase().execute({
        actorUserId: admin,
        leadPurchaseId: ctx.purchase.purchaseId,
        reasonCode: "PLATFORM_ERROR",
        explanation: "A MaestroYa defect made the paid lead unusable.",
        evidenceReference: "INC-M161-1",
      });
      expect(result.reasonCode).toBe("PLATFORM_ERROR");
      expect((await purchaseRow(ctx.purchase.purchaseId)).status).toBe("REFUNDED");
      expect(await deny(makeGetLeadContactUseCase().execute(ctx.buyer.userId, ctx.lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);
      expect(await prisma.leadFeeLedgerEntry.count()).toBe(1); // append-only history untouched by the refund
      expect(await prisma.leadFeeRefund.count()).toBe(1);
    });

    it("[E2E] dispute through the real route (M155): open -> DISPUTED (access stops) -> won -> CONFIRMED (access restored); lost -> REVOKED", async () => {
      const ctx = await confirmedPurchase();
      const send = async (type: "charge.dispute.created" | "charge.dispute.closed", status: string) =>
        webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(disputeEvent({ type, disputeId: "dp_m161_a", paymentIntentId: ctx.reference, amountMinorUnits: 2178, status }))));

      expect((await send("charge.dispute.created", "needs_response")).http).toBe(200);
      expect((await purchaseRow(ctx.purchase.purchaseId)).status).toBe("DISPUTED");
      expect(await deny(makeGetLeadContactUseCase().execute(ctx.buyer.userId, ctx.lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);

      expect((await send("charge.dispute.closed", "won")).http).toBe(200);
      expect((await purchaseRow(ctx.purchase.purchaseId)).status).toBe("CONFIRMED");
      expect((await makeGetLeadContactUseCase().execute(ctx.buyer.userId, ctx.lead.id)).email).toBe(ctx.customer.email);

      // A second chargeback on the same purchase that is LOST ends in REVOKED (no refund implied).
      const lost = async (type: "charge.dispute.created" | "charge.dispute.closed", status: string) =>
        webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(disputeEvent({ type, disputeId: "dp_m161_b", paymentIntentId: ctx.reference, amountMinorUnits: 2178, status }))));
      await lost("charge.dispute.created", "needs_response");
      await lost("charge.dispute.closed", "lost");
      expect((await purchaseRow(ctx.purchase.purchaseId)).status).toBe("REVOKED");
      expect(await deny(makeGetLeadContactUseCase().execute(ctx.buyer.userId, ctx.lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);
      expect(await prisma.leadFeeRefund.count()).toBe(0);
    });

    it("[E2E] administrative revocation (M155) ends access immediately, is idempotent, and creates no refund", async () => {
      const ctx = await confirmedPurchase();
      const admin = await seedAdmin(prisma);
      const input = { actorUserId: admin, leadPurchaseId: ctx.purchase.purchaseId, explanation: "Abuse confirmed by support.", evidenceReference: "INC-M161-2" };
      expect((await makeRevokeLeadPurchaseUseCase().execute(input)).revoked).toBe(true);
      expect((await makeRevokeLeadPurchaseUseCase().execute(input)).revoked).toBe(false);
      expect(await deny(makeGetLeadContactUseCase().execute(ctx.buyer.userId, ctx.lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);
      expect(await prisma.leadFeeRefund.count()).toBe(0);
    });

    it("[E2E] consent withdrawal (M158, basis CONSENT) ends contact access for FUTURE reads and triggers NO automatic refund (open decision M153/D12)", async () => {
      process.env.LEAD_CONTACT_SHARING_BASIS = "CONSENT";
      process.env.LEAD_CONTACT_SHARING_NOTICE_VERSION = "2026-10-v1";
      const category = await seedCategory(prisma, "fontaneria");
      const customer = await seedCustomer(prisma);
      const submitted = await makeSubmitLeadRequestUseCase(PRICING()).execute(customer.userId, REQUEST_INPUT(category.id), { contactSharingAccepted: true });
      expect(submitted.publication).toBe("PUBLISHED");
      const lead = await prisma.lead.findFirstOrThrow({ where: { serviceRequestId: submitted.receipt.requestId } });
      const buyer = await seedProfessional(prisma, { categoryId: category.id });
      const purchase = await makeInitiateLeadPurchaseUseCase().execute(buyer.userId, lead.id);
      await makeInitiateLeadFeePaymentUseCase().execute(buyer.userId, purchase.purchaseId);
      const reference = (await purchaseRow(purchase.purchaseId)).paymentReference!;
      await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent({ paymentIntentId: reference, amountMinorUnits: 2178, leadPurchaseId: purchase.purchaseId, leadId: lead.id })));
      expect((await makeGetLeadContactUseCase().execute(buyer.userId, lead.id)).email).toBe(customer.email);

      const withdrawn = await makeWithdrawLeadContactSharingUseCase().execute(customer.userId, lead.id);
      expect(withdrawn.changed).toBe(true);
      expect(await deny(makeGetLeadContactUseCase().execute(buyer.userId, lead.id))).toBeInstanceOf(LeadContactAccessDeniedError);
      // Observed contract: the purchase stays CONFIRMED (no refund, no revocation) - the refund consequence is the open decision D12.
      expect((await purchaseRow(purchase.purchaseId)).status).toBe("CONFIRMED");
      expect(await prisma.leadFeeRefund.count()).toBe(0);
      // Idempotent repeat.
      expect((await makeWithdrawLeadContactSharingUseCase().execute(customer.userId, lead.id)).changed).toBe(false);
    });
  });
});

function m161GatewayCreated() {
  return m161Gateway.current.created; // resolved lazily: each test sees the pristine provider installed by resetM161Gateway()
}
