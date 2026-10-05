import { beforeEach, describe, expect, it, vi } from "vitest";

import { LegacyFlowBoundaryError, type TransactionFlowVersion } from "@/domain/services/transaction-flow";
import type { TransactionFlowReader } from "@/application/ports/transaction-flow-reader";
import { TransactionFlowGuard } from "@/application/services/flow/transaction-flow-guard";
import { InitiateQuotePaymentUseCase } from "@/application/use-cases/payments/initiate-quote-payment.use-case";
import { ProcessCustomerPaymentWebhookUseCase } from "@/application/use-cases/payments/process-customer-payment-webhook.use-case";
import { ExecuteProfessionalPayoutUseCase } from "@/application/use-cases/payments/execute-professional-payout.use-case";
import { ExecutePayoutOnReleaseApprovedSubscriber } from "@/application/use-cases/payments/execute-payout-on-release-approved.subscriber";
import { RecordCommissionOnPaymentCapturedSubscriber } from "@/application/use-cases/payments/record-commission-on-payment-captured.subscriber";
import { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import { EvaluatePaymentReleaseUseCase } from "@/application/use-cases/job/evaluate-payment-release.use-case";
import { AdminResolvePaymentReleaseUseCase } from "@/application/use-cases/job/admin-resolve-payment-release.use-case";
import { CreateProfessionalInvoiceDraftUseCase } from "@/application/use-cases/invoicing/create-professional-invoice-draft.use-case";
import { CreateCustomerReceiptDraftUseCase } from "@/application/use-cases/invoicing/create-customer-receipt-draft.use-case";
import { ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber } from "@/application/use-cases/invoicing/activate-invoice-lifecycle-on-payment-release-approved.subscriber";
import { RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber } from "@/application/use-cases/affiliate/record-affiliate-conversion-on-payment-release-approved.subscriber";
import { AcceptQuoteUseCase } from "@/application/use-cases/quotes/accept-quote.use-case";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import {
  FakeCommissionRepository,
  FakeCustomerProfileRepository,
  FakeDistributedLock,
  FakeEventBus,
  FakeExternalWebhookEventRepository,
  FakeFinancialLedgerRepository,
  FakeJobRepository,
  FakePaymentGateway,
  FakePaymentRepository,
  FakePayoutRepository,
  FakeQuoteRepository,
  FakeStripeTransferGateway,
  fakeFeatureFlags,
  fakeJobRecord,
  fakeQuoteRecord,
} from "../payments/fakes";

/**
 * Module 121 — Legacy Freeze & Flow Version Boundary.
 *
 * Proves a LEAD_V1 ServiceRequest can never reach any legacy customer-payment
 * / commission / release / payout / invoicing operation, and that
 * LEGACY_QUOTE_PAYMENT keeps flowing exactly as before.
 */
class FakeFlowReader implements TransactionFlowReader {
  flows = new Map<string, TransactionFlowVersion>();
  async findFlowVersion(id: string) {
    return this.flows.get(id) ?? null;
  }
}

/** Any dependency call on this object fails the test — proves a blocked
 *  operation never touched it. */
function tripwire(name: string): never {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return () => {
          throw new Error(`tripwire: ${name}.${String(prop)} must not be called for a LEAD_V1 request`);
        };
      },
    },
  ) as never;
}

const LEAD_REQUEST = "request-lead";
const LEGACY_REQUEST = "request-legacy";

let flows: FakeFlowReader;
let guard: TransactionFlowGuard;

beforeEach(() => {
  flows = new FakeFlowReader();
  flows.flows.set(LEAD_REQUEST, "LEAD_V1");
  flows.flows.set(LEGACY_REQUEST, "LEGACY_QUOTE_PAYMENT");
  guard = new TransactionFlowGuard(flows);
});

function paymentRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "payment-1",
    serviceRequestId: LEAD_REQUEST,
    quoteId: "quote-1",
    jobId: "job-1",
    payerId: "user-1",
    amount: 100,
    currency: "EUR",
    status: "PENDING",
    capturedAt: null,
    stripePaymentIntentId: "pi_123",
    method: "CARD",
    failureReason: null,
    ...overrides,
  };
}

function webhookEvent(type: string, id = "evt_1"): StripePaymentWebhookEvent {
  return {
    id,
    type,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    paymentIntent: { paymentIntentId: "pi_123", lastPaymentErrorMessage: null },
    chargeRefunded: null,
    dispute: null,
    chargeUpdated: null,
  };
}

describe("TransactionFlowGuard", () => {
  it("allows LEGACY_QUOTE_PAYMENT and blocks LEAD_V1", async () => {
    await expect(guard.assertLegacy(LEGACY_REQUEST, "commission.record")).resolves.toBeUndefined();
    await expect(guard.assertLegacy(LEAD_REQUEST, "commission.record")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
  });

  it("fails closed on an unknown flow value", async () => {
    flows.flows.set("weird", "SOMETHING_ELSE" as TransactionFlowVersion);
    await expect(guard.assertLegacy("weird", "commission.record")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
  });
});

describe("LEAD_V1 boundary (tests 1-6)", () => {
  it("1. cannot create a legacy customer payment (no PaymentIntent, no Payment row)", async () => {
    const jobs = new FakeJobRepository();
    const payments = new FakePaymentRepository();
    const gateway = new FakePaymentGateway();
    const customers = new FakeCustomerProfileRepository();
    customers.seed({ id: "customer-1", userId: "user-1", customerType: "PRIVATE_CUSTOMER" });
    jobs.seed(fakeJobRecord({ serviceRequestId: LEAD_REQUEST }));
    const quotes = new FakeQuoteRepository();
    quotes.seed(fakeQuoteRecord({ serviceRequestId: LEAD_REQUEST }));
    const useCase = new InitiateQuotePaymentUseCase(
      customers,
      jobs,
      quotes,
      payments,
      gateway,
      new FakeDistributedLock(),
      fakeFeatureFlags(true),
      guard,
    );

    await expect(useCase.execute("user-1", "job-1")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
    expect(gateway.authorizeCalls).toHaveLength(0);
    expect(payments.byId.size).toBe(0);
  });

  it("1b. quote acceptance (the only door to a Job/Payment) is closed for LEAD_V1", async () => {
    const customers = new FakeCustomerProfileRepository();
    customers.seed({ id: "customer-1", userId: "user-1", customerType: "PRIVATE_CUSTOMER" });
    const serviceRequests = { findById: vi.fn().mockResolvedValue({ id: LEAD_REQUEST, customerId: "customer-1" }) };
    const useCase = new AcceptQuoteUseCase(
      customers,
      serviceRequests as never,
      tripwire("quotes"),
      tripwire("quoteAcceptance"),
      undefined,
      undefined,
      undefined,
      guard,
    );

    await expect(useCase.execute("user-1", LEAD_REQUEST, "quote-1")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
  });

  it("1c. a Stripe capture webhook for a LEAD_V1 payment neither captures funds nor publishes PaymentCaptured", async () => {
    const payments = new FakePaymentRepository();
    payments.seed(paymentRecord());
    const gateway = new FakePaymentGateway();
    const bus = new FakeEventBus();
    const useCase = new ProcessCustomerPaymentWebhookUseCase(
      payments,
      gateway,
      new FakeExternalWebhookEventRepository(),
      bus,
      undefined,
      null,
      null,
      null,
      guard,
    );

    const first = await useCase.execute(webhookEvent("payment_intent.amount_capturable_updated", "evt_1"));
    const second = await useCase.execute(webhookEvent("payment_intent.succeeded", "evt_2"));

    expect(first.outcome).toBe("ignored");
    expect(second.outcome).toBe("ignored");
    expect(gateway.captureCalls).toHaveLength(0);
    expect(bus.published).toHaveLength(0);
    expect((await payments.findById("payment-1"))?.status).toBe("PENDING");
  });

  it("2. cannot create a legacy Commission or commission ledger entries", async () => {
    const payments = new FakePaymentRepository();
    payments.seed(paymentRecord({ status: "CAPTURED" }));
    const commissions = new FakeCommissionRepository();
    const ledger = new FakeFinancialLedgerRepository();
    const useCase = new RecordCommissionForPaymentUseCase(
      payments,
      commissions,
      ledger,
      tripwire("breakdowns"),
      tripwire("completionConfirmations"),
      guard,
    );

    await expect(useCase.execute("payment-1")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
    expect(commissions.byPaymentId.size).toBe(0);
  });

  it("3. cannot trigger PaymentRelease (evaluation or admin resolution) — no decision written, no event", async () => {
    const jobs = new FakeJobRepository();
    jobs.seed(fakeJobRecord({ serviceRequestId: LEAD_REQUEST }));
    const bus = new FakeEventBus();

    const evaluate = new EvaluatePaymentReleaseUseCase(
      jobs,
      tripwire("confirmations"),
      tripwire("disputes"),
      tripwire("payments"),
      tripwire("professionals"),
      tripwire("trustAutomatedActions"),
      tripwire("payoutEligibility"),
      bus,
      undefined,
      undefined,
      guard,
    );
    await expect(evaluate.execute("job-1")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);

    const admin = new AdminResolvePaymentReleaseUseCase(
      jobs,
      tripwire("confirmations"),
      tripwire("disputes"),
      tripwire("manualReviewCases"),
      tripwire("payments"),
      tripwire("professionals"),
      tripwire("trustAutomatedActions"),
      tripwire("payoutEligibility"),
      bus,
      tripwire("auditLog"),
      undefined,
      undefined,
      guard,
    );
    await expect(admin.execute("admin-1", "job-1", "APPROVE", "note")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);

    expect(bus.published).toHaveLength(0);
  });

  it("4+5. cannot trigger a Professional Payout or a Stripe Connect transfer", async () => {
    const jobs = new FakeJobRepository();
    jobs.seed(fakeJobRecord({ serviceRequestId: LEAD_REQUEST }));
    const payouts = new FakePayoutRepository();
    const transfers = new FakeStripeTransferGateway();
    const bus = new FakeEventBus();
    const useCase = new ExecuteProfessionalPayoutUseCase(
      jobs,
      tripwire("payments"),
      tripwire("completionConfirmations"),
      tripwire("disputes"),
      tripwire("commissions"),
      tripwire("recordCommission"),
      tripwire("professionals"),
      tripwire("companies"),
      tripwire("trustAutomatedActions"),
      tripwire("payoutEligibility"),
      tripwire("destinationResolver"),
      payouts,
      transfers,
      new FakeDistributedLock(),
      bus,
      undefined,
      undefined,
      false,
      guard,
    );

    await expect(useCase.execute("job-1")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
    expect(transfers.calls).toHaveLength(0);
    expect(payouts.byId.size).toBe(0);
    expect(bus.published).toHaveLength(0);
  });

  it("6. cannot create a legacy self-billed invoice or customer receipt", async () => {
    const jobs = new FakeJobRepository();
    jobs.seed(fakeJobRecord({ serviceRequestId: LEAD_REQUEST, status: "COMPLETED" }));
    const invoiceRepo = { findByJobId: vi.fn().mockResolvedValue(null), findByJobIdAndType: vi.fn().mockResolvedValue(null) };
    const bus = new FakeEventBus();

    const proInvoice = new CreateProfessionalInvoiceDraftUseCase(
      jobs,
      tripwire("payments"),
      tripwire("quotes"),
      tripwire("professionals"),
      tripwire("companies"),
      tripwire("selfBillingAuthorizations"),
      invoiceRepo as never,
      tripwire("taxBreakdowns"),
      bus,
      undefined,
      guard,
    );
    const receipt = new CreateCustomerReceiptDraftUseCase(
      jobs,
      tripwire("payments"),
      tripwire("quotes"),
      tripwire("customerProfiles"),
      tripwire("users"),
      invoiceRepo as never,
      tripwire("taxBreakdowns"),
      bus,
      undefined,
      guard,
    );

    await expect(proInvoice.execute("job-1")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
    await expect(receipt.execute("job-1")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
    expect(bus.published).toHaveLength(0);
  });
});

describe("Event boundary — legacy event consumers stay quiet for LEAD_V1", () => {
  it("commission / payout / invoicing subscribers swallow the boundary error without side effects", async () => {
    const boundary = new LegacyFlowBoundaryError("commission.record", "LEAD_V1");
    const recordCommission = { execute: vi.fn().mockRejectedValue(boundary) };
    const executePayout = { execute: vi.fn().mockRejectedValue(boundary) };

    await expect(
      new RecordCommissionOnPaymentCapturedSubscriber(recordCommission as never).handle(
        new PaymentCaptured("payment-1", 100, "EUR"),
      ),
    ).resolves.toBeUndefined();
    await expect(
      new ExecutePayoutOnReleaseApprovedSubscriber(executePayout as never).handle(
        new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"),
      ),
    ).resolves.toBeUndefined();

    const invoices = { findByJobIdAndType: vi.fn().mockResolvedValue(null) };
    const createDraft = { execute: vi.fn().mockRejectedValue(boundary) };
    const submit = { execute: vi.fn() };
    const accept = { execute: vi.fn() };
    const issue = { execute: vi.fn() };
    const createReceipt = { execute: vi.fn().mockRejectedValue(boundary) };
    await expect(
      new ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber(
        invoices as never,
        tripwire("professionals"),
        tripwire("companies"),
        createDraft as never,
        submit as never,
        accept as never,
        issue as never,
        createReceipt as never,
      ).handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1")),
    ).resolves.toBeUndefined();
    expect(submit.execute).not.toHaveBeenCalled();
    expect(issue.execute).not.toHaveBeenCalled();
  });

  it("affiliate conversion subscriber records no conversion and reports no failure for LEAD_V1", async () => {
    const payments = new FakePaymentRepository();
    payments.seed(paymentRecord({ status: "CAPTURED" }));
    const recordCommission = {
      execute: vi.fn().mockRejectedValue(new LegacyFlowBoundaryError("commission.record", "LEAD_V1")),
    };
    const recordConversion = { execute: vi.fn() };
    const recordAffiliateCommission = { execute: vi.fn() };
    const failureReporter = { report: vi.fn() };
    const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
      payments,
      { findByUserId: vi.fn().mockResolvedValue({ visitorId: "v1" }) } as never,
      recordCommission as never,
      recordConversion as never,
      recordAffiliateCommission as never,
      failureReporter as never,
      undefined,
      guard,
    );

    await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

    // Module 131: the subscriber's OWN guard stops LEAD_V1 before the
    // attribution read and before the commission use case is even called.
    expect(recordCommission.execute).not.toHaveBeenCalled();
    expect(recordConversion.execute).not.toHaveBeenCalled();
    expect(recordAffiliateCommission.execute).not.toHaveBeenCalled();
    expect(failureReporter.report).not.toHaveBeenCalled();
  });
});

describe("LEGACY_QUOTE_PAYMENT keeps the existing path (tests 7 + 10)", () => {
  it("7. initiates a payment exactly as before when the guard says legacy", async () => {
    const jobs = new FakeJobRepository();
    jobs.seed(fakeJobRecord({ serviceRequestId: LEGACY_REQUEST }));
    const quotes = new FakeQuoteRepository();
    quotes.seed(fakeQuoteRecord({ serviceRequestId: LEGACY_REQUEST }));
    const customers = new FakeCustomerProfileRepository();
    customers.seed({ id: "customer-1", userId: "user-1", customerType: "PRIVATE_CUSTOMER" });
    const payments = new FakePaymentRepository();
    const gateway = new FakePaymentGateway();
    const useCase = new InitiateQuotePaymentUseCase(
      customers,
      jobs,
      quotes,
      payments,
      gateway,
      new FakeDistributedLock(),
      fakeFeatureFlags(true),
      guard,
    );

    const result = await useCase.execute("user-1", "job-1");

    expect(result.amount).toBe(100);
    expect(gateway.authorizeCalls).toHaveLength(1);
    expect((await payments.findById(result.paymentId))?.status).toBe("PENDING");
  });

  it("10. repeated webhook delivery captures once and publishes PaymentCaptured once", async () => {
    const payments = new FakePaymentRepository();
    payments.seed(paymentRecord({ serviceRequestId: LEGACY_REQUEST }));
    const gateway = new FakePaymentGateway();
    const bus = new FakeEventBus();
    const useCase = new ProcessCustomerPaymentWebhookUseCase(
      payments,
      gateway,
      new FakeExternalWebhookEventRepository(),
      bus,
      undefined,
      null,
      null,
      null,
      guard,
    );

    const a = await useCase.execute(webhookEvent("payment_intent.amount_capturable_updated", "evt_1"));
    const b = await useCase.execute(webhookEvent("payment_intent.amount_capturable_updated", "evt_2"));
    const c = await useCase.execute(webhookEvent("payment_intent.succeeded", "evt_3"));

    expect(a.outcome).toBe("captured");
    expect(b.outcome).toBe("already-settled");
    expect(c.outcome).toBe("already-settled");
    expect(gateway.captureCalls).toHaveLength(1);
    expect(bus.published.filter((e) => e instanceof PaymentCaptured)).toHaveLength(1);
  });
});
