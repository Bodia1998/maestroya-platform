import { beforeEach, describe, expect, it } from "vitest";

import { CalculateJobCommissionBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-commission-breakdown.use-case";
import { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import { InitiateQuotePaymentUseCase } from "@/application/use-cases/payments/initiate-quote-payment.use-case";
import { ProcessCustomerPaymentWebhookUseCase } from "@/application/use-cases/payments/process-customer-payment-webhook.use-case";
import { RecordCommissionOnPaymentCapturedSubscriber } from "@/application/use-cases/payments/record-commission-on-payment-captured.subscriber";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { ValidationError } from "@/domain/errors/domain-error";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import type { PaymentReleaseStatus } from "@/domain/services/payment-release-decision";
import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import {
  FakeCustomerProfileRepository,
  FakeJobRepository,
  FakeQuoteAcceptanceRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
  createAppointmentStore,
  createJobStore,
} from "../booking/fakes";
import { FakeProfessionalRepository } from "../quotes/fakes";
import {
  FakeCommissionRateRepository,
  FakeCommissionRepository,
  FakeFinancialLedgerRepository,
  FakeJobCompletionConfirmationRepository,
  FakePaymentRepository,
} from "../financial/fakes";
import {
  FakeDistributedLock,
  FakeEventBus,
  FakeExternalWebhookEventRepository,
  FakePaymentGateway,
  fakeFeatureFlags,
} from "../../unit/core/application/use-cases/payments/fakes";

/**
 * Module 73 — Real Customer Payment Capture: end-to-end integration test
 * for the complete flow the module brief specifies:
 *
 *   Accepted Quote -> customer initiates payment -> server calculates
 *   amount -> PaymentIntent created -> Payment persisted -> payment
 *   succeeds -> webhook received -> Payment becomes CAPTURED ->
 *   PaymentCaptured event emitted -> commission recorded.
 *
 * Real use cases end to end (InitiateQuotePaymentUseCase,
 * ProcessCustomerPaymentWebhookUseCase, RecordCommissionForPaymentUseCase,
 * the real `PaymentCaptured` domain event and a real synchronous-style
 * event bus), fake infrastructure (repositories, gateway, lock) — the same
 * "real use cases + domain services, fakes for storage" convention
 * `tests/integration/financial/financial-flows.test.ts` (Module 22)
 * already establishes, reusing its exact booking/financial fakes so this
 * test builds a genuinely accepted Quote/Job through the real
 * `QuoteAcceptanceRepository.acceptQuote` transaction, not a hand-rolled
 * shortcut.
 */

let counter = 0;

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const appointmentStore = createAppointmentStore();
  const jobStore = createJobStore();
  const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests, appointmentStore, jobStore);
  const jobs = new FakeJobRepository(jobStore, appointmentStore);
  const rates = new FakeCommissionRateRepository();
  const commissions = new FakeCommissionRepository();
  const ledger = new FakeFinancialLedgerRepository();
  // Module 73's own Payment.create() never receives a jobId directly (see
  // PaymentRepository.create's own doc comment — jobId is always resolved
  // via the Payment -> Quote -> Job relation) — this resolver reproduces
  // that same relation against this test's own in-memory quote/job stores,
  // exactly like PrismaPaymentRepository does against the real schema.
  const payments = new FakePaymentRepository((quoteId) => {
    const job = [...jobStore.values()].find((j) => j.quoteId === quoteId);
    return job?.id ?? null;
  });
  const completionConfirmations = new FakeJobCompletionConfirmationRepository();
  const paymentGateway = new FakePaymentGateway();
  const lock = new FakeDistributedLock();
  const webhookEvents = new FakeExternalWebhookEventRepository();
  const eventBus = new FakeEventBus();

  const breakdowns = new CalculateJobCommissionBreakdownUseCase(jobs, quotes, rates);
  const recordCommission = new RecordCommissionForPaymentUseCase(
    payments,
    commissions,
    ledger,
    breakdowns,
    completionConfirmations,
  );

  eventBus.subscribe(PaymentCaptured, new RecordCommissionOnPaymentCapturedSubscriber(recordCommission));

  const initiatePayment = new InitiateQuotePaymentUseCase(
    customerProfiles,
    jobs,
    quotes,
    payments,
    paymentGateway,
    lock,
    fakeFeatureFlags(true),
  );
  const processWebhook = new ProcessCustomerPaymentWebhookUseCase(payments, paymentGateway, webhookEvents, eventBus);

  return {
    customerProfiles,
    professionals,
    serviceRequests,
    quotes,
    quoteAcceptance,
    jobs,
    commissions,
    ledger,
    payments,
    completionConfirmations,
    paymentGateway,
    lock,
    webhookEvents,
    eventBus,
    initiatePayment,
    processWebhook,
    recordCommission,
  };
}

type Repos = ReturnType<typeof makeRepos>;

async function seedRequest(repos: Repos, customerUserId: string): Promise<ServiceRequestRecord> {
  const customer = await repos.customerProfiles.findOrCreateByUserId(customerUserId);
  counter += 1;
  const now = new Date();
  return repos.serviceRequests.seed({
    id: `request-${counter}`,
    customerId: customer.id,
    categoryId: "cat-plumbing",
    categoryName: "Plumbing",
    title: "Fix leaking kitchen tap",
    description: "Dripping for a week.",
    status: "PUBLISHED",
    urgency: "MEDIUM",
    budgetMin: null,
    budgetMax: null,
    location: {
      line1: "Calle Mayor 1",
      line2: null,
      city: "Oliva",
      province: "Valencia",
      postalCode: "46780",
      country: "ES",
      latitude: null,
      longitude: null,
    },
    photos: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Labor = 1000, Materials = 500 -> a payable total of 1500. */
async function seedAcceptedQuote(repos: Repos, customerUserId: string, professionalUserId: string) {
  const professional = await repos.professionals.create(professionalUserId, {});
  const request = await seedRequest(repos, customerUserId);
  const items = [
    { description: "Labor", quantity: 1, unitPrice: 1000, category: "LABOR" as const },
    { description: "Materials", quantity: 1, unitPrice: 500, category: "MATERIALS" as const },
  ];
  // Deliberately seeded with a WRONG totalAmount — proves the payment use
  // case never trusts this stored column, only the items themselves.
  const quote = await repos.quotes.create({
    serviceRequestId: request.id,
    professionalProfileId: professional.id,
    submittedByUserId: professionalUserId,
    totalAmount: 999_999,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items,
  });
  const result = await repos.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id });
  return { request, professional, job: result.job, quote };
}

function seedApprovedRelease(repos: Repos, jobId: string) {
  counter += 1;
  const now = new Date();
  return repos.completionConfirmations.seed({
    id: `completion-confirmation-${counter}`,
    jobId,
    status: "CONFIRMED",
    professionalCompletedAt: now,
    confirmationDeadlineAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
    confirmedAt: now,
    confirmedByUserId: "user-confirmed-by-test",
    disputeId: null,
    manualReviewCaseId: null,
    reminderSentAt: null,
    releaseStatus: "RELEASE_APPROVED" as PaymentReleaseStatus,
    releaseReason: "Test-seeded: RELEASE_APPROVED.",
    releaseDecidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

function paymentIntentSucceededEvent(paymentIntentId: string): StripePaymentWebhookEvent {
  return {
    id: `evt-${paymentIntentId}`,
    type: "payment_intent.amount_capturable_updated",
    createdAt: new Date(),
    paymentIntent: { paymentIntentId, lastPaymentErrorMessage: null },
    chargeRefunded: null,
  };
}

const CUSTOMER = "user-customer-1";
const PROFESSIONAL = "user-professional-1";

describe("Module 73 — Real Customer Payment Capture end-to-end flow", () => {
  beforeEach(() => {
    counter = 0;
  });

  it("takes an accepted Quote all the way to a captured Payment with commission recorded exactly once", async () => {
    const repos = makeRepos();
    const { job, quote } = await seedAcceptedQuote(repos, CUSTOMER, PROFESSIONAL);
    seedApprovedRelease(repos, job.id);

    // 1. Customer initiates payment — server recomputes the amount from
    // the Quote's own items (1000 + 500 = 1500), never trusting the
    // deliberately-wrong `totalAmount` seeded above.
    const initiation = await repos.initiatePayment.execute(CUSTOMER, job.id);
    expect(initiation.amount).toBe(1500);
    expect(initiation.currency).toBe("EUR");
    expect(initiation.clientSecret).toBeTruthy();

    const persisted = await repos.payments.findById(initiation.paymentId);
    expect(persisted?.status).toBe("PENDING");
    expect(persisted?.amount).toBe(1500);
    expect(persisted?.quoteId).toBe(quote.id);

    // 2. Stripe reports the authorization succeeded -> webhook captures.
    const stripePaymentIntentId = persisted!.stripePaymentIntentId!;
    const webhookResult = await repos.processWebhook.execute(paymentIntentSucceededEvent(stripePaymentIntentId));
    expect(webhookResult.outcome).toBe("captured");

    const captured = await repos.payments.findById(initiation.paymentId);
    expect(captured?.status).toBe("CAPTURED");
    expect(captured?.capturedAt).toBeInstanceOf(Date);

    // 3. PaymentCaptured was published exactly once, and the subscriber
    // recorded commission from it — 10% flat commission of 1500 = 150.
    const capturedEvents = repos.eventBus.published.filter((e) => e instanceof PaymentCaptured);
    expect(capturedEvents).toHaveLength(1);

    const commission = await repos.commissions.findByPaymentId(initiation.paymentId);
    expect(commission).not.toBeNull();
    expect(commission?.amount).toBe(150);
    expect(commission?.professionalProfileId).toBe(quote.professionalProfileId);

    // 4. Commission was recorded exactly once — a second manual call is
    // idempotent (RecordCommissionForPaymentUseCase's own contract).
    const secondCall = await repos.recordCommission.execute(initiation.paymentId);
    expect(secondCall.id).toBe(commission!.id);
  });

  it("never creates two Stripe charges or two Payment rows even under a duplicate webhook delivery", async () => {
    const repos = makeRepos();
    const { job } = await seedAcceptedQuote(repos, CUSTOMER, PROFESSIONAL);
    seedApprovedRelease(repos, job.id);

    const initiation = await repos.initiatePayment.execute(CUSTOMER, job.id);
    const stripePaymentIntentId = (await repos.payments.findById(initiation.paymentId))!.stripePaymentIntentId!;

    // `paymentIntentSucceededEvent` derives a deterministic event id from
    // the PaymentIntent id, so both deliveries below carry the exact same
    // Stripe event id — a genuine duplicate delivery, not two different
    // events about the same PaymentIntent.
    const first = await repos.processWebhook.execute(paymentIntentSucceededEvent(stripePaymentIntentId));
    const second = await repos.processWebhook.execute(paymentIntentSucceededEvent(stripePaymentIntentId));

    expect(first.outcome).toBe("captured");
    expect(second.outcome).toBe("duplicate");
    expect(repos.paymentGateway.captureCalls).toHaveLength(1);
    expect(repos.eventBus.published.filter((e) => e instanceof PaymentCaptured)).toHaveLength(1);
  });

  it("refuses to pay a quote that doesn't belong to the authenticated customer", async () => {
    const repos = makeRepos();
    const { job } = await seedAcceptedQuote(repos, CUSTOMER, PROFESSIONAL);

    await expect(repos.initiatePayment.execute("some-other-user", job.id)).rejects.toThrow();
  });

  it("refuses a second payment attempt once the job has already been paid", async () => {
    const repos = makeRepos();
    const { job } = await seedAcceptedQuote(repos, CUSTOMER, PROFESSIONAL);
    seedApprovedRelease(repos, job.id);

    const initiation = await repos.initiatePayment.execute(CUSTOMER, job.id);
    const stripePaymentIntentId = (await repos.payments.findById(initiation.paymentId))!.stripePaymentIntentId!;
    await repos.processWebhook.execute(paymentIntentSucceededEvent(stripePaymentIntentId));

    await expect(repos.initiatePayment.execute(CUSTOMER, job.id)).rejects.toBeInstanceOf(ValidationError);
  });
});
