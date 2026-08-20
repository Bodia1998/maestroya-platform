import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { InitiateQuotePaymentUseCase } from "@/application/use-cases/payments/initiate-quote-payment.use-case";
import {
  FakeCustomerProfileRepository,
  FakeDistributedLock,
  FakeJobRepository,
  FakePaymentGateway,
  FakePaymentRepository,
  FakeQuoteRepository,
  fakeFeatureFlags,
  fakeJobRecord,
  fakeQuoteRecord,
} from "./fakes";

/**
 * Module 73 — Real Customer Payment Capture: application-level tests for
 * `InitiateQuotePaymentUseCase`. Real use case, fake repositories/gateway —
 * same convention `process-stripe-connect-webhook.use-case.test.ts`
 * (Module 72) establishes.
 */
describe("InitiateQuotePaymentUseCase (Module 73)", () => {
  let customerProfiles: FakeCustomerProfileRepository;
  let jobs: FakeJobRepository;
  let quotes: FakeQuoteRepository;
  let payments: FakePaymentRepository;
  let gateway: FakePaymentGateway;
  let lock: FakeDistributedLock;
  let useCase: InitiateQuotePaymentUseCase;

  const USER_ID = "user-1";

  beforeEach(() => {
    customerProfiles = new FakeCustomerProfileRepository();
    jobs = new FakeJobRepository();
    quotes = new FakeQuoteRepository();
    payments = new FakePaymentRepository();
    gateway = new FakePaymentGateway();
    lock = new FakeDistributedLock();
    useCase = new InitiateQuotePaymentUseCase(
      customerProfiles,
      jobs,
      quotes,
      payments,
      gateway,
      lock,
      fakeFeatureFlags(true),
    );

    customerProfiles.seed({ id: "customer-1", userId: USER_ID });
    jobs.seed(fakeJobRecord());
    quotes.seed(fakeQuoteRecord());
  });

  it("creates a PaymentIntent and persists a PENDING Payment for the customer's own accepted quote", async () => {
    const result = await useCase.execute(USER_ID, "job-1");

    expect(result.amount).toBe(100);
    expect(result.currency).toBe("EUR");
    expect(result.clientSecret).toBe("pi_fake_1_secret");
    expect(gateway.authorizeCalls).toHaveLength(1);

    const stored = await payments.findById(result.paymentId);
    expect(stored?.status).toBe("PENDING");
    expect(stored?.stripePaymentIntentId).toBe("pi_fake_1");
    expect(stored?.payerId).toBe(USER_ID);
  });

  it("never trusts a client-supplied amount — recomputes it server-side from the Quote's own items", async () => {
    // Simulate a stale/tampered totalAmount column — the use case must
    // never read this field, only recompute from `items`.
    quotes.seed(fakeQuoteRecord({ totalAmount: 999_999 }));

    const result = await useCase.execute(USER_ID, "job-1");

    expect(result.amount).toBe(100);
    expect(gateway.authorizeCalls[0]?.amount).toBe(100);
  });

  it("rejects a job that does not belong to the authenticated customer (IDOR)", async () => {
    jobs.seed(fakeJobRecord({ id: "job-1", customerId: "someone-elses-customer-id" }));

    await expect(useCase.execute(USER_ID, "job-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a job id that doesn't exist the same way as one that isn't the caller's own", async () => {
    await expect(useCase.execute(USER_ID, "no-such-job")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a cancelled job", async () => {
    jobs.seed(fakeJobRecord({ status: "CANCELLED" }));

    await expect(useCase.execute(USER_ID, "job-1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a quote that is not ACCEPTED", async () => {
    quotes.seed(fakeQuoteRecord({ status: "SENT" }));

    await expect(useCase.execute(USER_ID, "job-1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a second payment attempt once the quote is already CAPTURED", async () => {
    payments.seed({
      id: "existing-payment",
      serviceRequestId: "request-1",
      quoteId: "quote-1",
      jobId: "job-1",
      payerId: USER_ID,
      amount: 100,
      currency: "EUR",
      status: "CAPTURED",
      capturedAt: new Date(),
      stripePaymentIntentId: "pi_already_captured",
      method: "CARD",
      failureReason: null,
    });

    await expect(useCase.execute(USER_ID, "job-1")).rejects.toBeInstanceOf(ValidationError);
    expect(gateway.authorizeCalls).toHaveLength(0);
  });

  it("is safe to retry a still-PENDING attempt — resolves to the same PaymentIntent, never a duplicate", async () => {
    const first = await useCase.execute(USER_ID, "job-1");
    const second = await useCase.execute(USER_ID, "job-1");

    // Same deterministic idempotency key both times -> same fake Stripe
    // PaymentIntent id -> the repository's create-is-an-upsert semantics
    // converge on the same row.
    expect(second.paymentId).toBe(first.paymentId);
    expect(gateway.authorizeCalls).toHaveLength(2);
    expect(gateway.authorizeCalls[0]?.idempotencyKey).toBe(gateway.authorizeCalls[1]?.idempotencyKey);

    const all = [...payments.byId.values()].filter((p) => p.quoteId === "quote-1");
    expect(all).toHaveLength(1);
  });

  it("rejects (rather than duplicating) a second request for the same quote while the first is still in flight under the lock", async () => {
    const [aResult, bResult] = await Promise.allSettled([
      useCase.execute(USER_ID, "job-1"),
      useCase.execute(USER_ID, "job-1"),
    ]);

    // The application-level lock (layer 1 of the module's three-layer
    // idempotency story) means the loser is bounced with a "try again"
    // error rather than silently proceeding — never two PaymentIntents.
    const settled = [aResult, bResult];
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);

    const all = [...payments.byId.values()].filter((p) => p.quoteId === "quote-1");
    expect(all).toHaveLength(1);
    expect(gateway.authorizeCalls).toHaveLength(1);

    // Once the lock is free again, a retry converges onto the same Payment
    // via layers 2 (Stripe idempotency key) and 3 (DB upsert) — never a
    // second row.
    const retry = await useCase.execute(USER_ID, "job-1");
    const winner = aResult.status === "fulfilled" ? aResult.value : (bResult as PromiseFulfilledResult<Awaited<ReturnType<typeof useCase.execute>>>).value;
    expect(retry.paymentId).toBe(winner.paymentId);
    const allAfterRetry = [...payments.byId.values()].filter((p) => p.quoteId === "quote-1");
    expect(allAfterRetry).toHaveLength(1);
  });

  it("refuses to start a new payment when the feature flag is disabled", async () => {
    useCase = new InitiateQuotePaymentUseCase(
      customerProfiles,
      jobs,
      quotes,
      payments,
      gateway,
      lock,
      fakeFeatureFlags(false),
    );

    await expect(useCase.execute(USER_ID, "job-1")).rejects.toBeInstanceOf(ValidationError);
    expect(gateway.authorizeCalls).toHaveLength(0);
  });
});
