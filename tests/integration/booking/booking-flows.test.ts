import { describe, expect, it, vi } from "vitest";

import { AcceptQuoteUseCase } from "@/application/use-cases/quotes/accept-quote.use-case";
import type { ServiceRequestRecord, ServiceRequestStatusValue } from "@/domain/repositories/service-request-repository";
import type { QuoteStatusValue } from "@/domain/repositories/quote-repository";
import {
  FakeCustomerProfileRepository,
  FakeQuoteAcceptanceRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
} from "./fakes";

/**
 * Integration tests for the Booking/Appointments module's central use case,
 * AcceptQuoteUseCase — the transition:
 *   Customer -> owns ServiceRequest -> views Quotes -> accepts one eligible
 *   Quote -> atomic transaction (Quote ACCEPTED, competing Quotes REJECTED,
 *   ServiceRequest ACCEPTED, Appointment created).
 *
 * Follows the same pattern as tests/integration/quotes/quote-flows.test.ts:
 * real use case + domain services, fake repositories swapped in for storage.
 */

let requestIdCounter = 0;

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests);
  return { customerProfiles, serviceRequests, quotes, quoteAcceptance };
}

async function seedPublishedRequest(
  repos: ReturnType<typeof makeRepos>,
  customerUserId: string,
  status: ServiceRequestStatusValue = "PUBLISHED",
): Promise<ServiceRequestRecord> {
  const customer = await repos.customerProfiles.findOrCreateByUserId(customerUserId);
  requestIdCounter += 1;
  const now = new Date();
  return repos.serviceRequests.seed({
    id: `request-${requestIdCounter}`,
    customerId: customer.id,
    categoryId: "cat-plumbing",
    categoryName: "Plumbing",
    title: "Fix leaking kitchen tap",
    description: "The tap under the kitchen sink has been dripping for a week.",
    status,
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

async function seedQuote(
  repos: ReturnType<typeof makeRepos>,
  serviceRequestId: string,
  professionalProfileId: string,
  status: QuoteStatusValue = "SENT",
) {
  const quote = await repos.quotes.create({
    serviceRequestId,
    professionalProfileId,
    submittedByUserId: `user-of-${professionalProfileId}`,
    totalAmount: 100,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items: [{ description: "Labor", quantity: 2, unitPrice: 50 }],
  });
  if (status !== "SENT") {
    await repos.quotes.updateStatus(quote.id, status);
    return (await repos.quotes.findById(quote.id))!;
  }
  return quote;
}

function makeUseCase(repos: ReturnType<typeof makeRepos>) {
  return new AcceptQuoteUseCase(repos.customerProfiles, repos.serviceRequests, repos.quotes, repos.quoteAcceptance);
}

describe("Server Action auth boundary (unauthenticated users)", () => {
  // AcceptQuoteAction calls requireAuth() before ever touching the use
  // case — mirrors the same coverage as quote-flows.test.ts /
  // service-request-flows.test.ts's equivalent checks, for this module's
  // own action (acceptQuoteAction).
  it("requireAuth throws (and never resolves a userId) when there is no session", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
    const { requireAuth } = await import("@/infrastructure/auth/rbac");

    await expect(requireAuth()).rejects.toThrow();

    vi.doUnmock("@/lib/auth");
  });
});

describe("AcceptQuoteUseCase — authorization", () => {
  it("rejects a signed-in user with no CustomerProfile at all", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1");

    await expect(
      makeUseCase(repos).execute("user-without-profile", request.id, quote.id),
    ).rejects.toThrow();
  });

  it("rejects a customer accepting a quote on another customer's ServiceRequest", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1");
    await repos.customerProfiles.findOrCreateByUserId("cust-2");

    await expect(makeUseCase(repos).execute("cust-2", request.id, quote.id)).rejects.toThrow();

    // No partial mutation happened on the rejected attempt.
    expect((await repos.quotes.findById(quote.id))?.status).toBe("SENT");
    expect((await repos.serviceRequests.findById(request.id))?.status).toBe("PUBLISHED");
  });

  it("rejects a quote that belongs to a different ServiceRequest than the one supplied", async () => {
    const repos = makeRepos();
    const requestA = await seedPublishedRequest(repos, "cust-1");
    const requestB = await seedPublishedRequest(repos, "cust-1");
    const quoteForB = await seedQuote(repos, requestB.id, "pro-1");

    await expect(
      makeUseCase(repos).execute("cust-1", requestA.id, quoteForB.id),
    ).rejects.toThrow();
  });
});

describe("AcceptQuoteUseCase — Quote state", () => {
  it("accepts a SENT quote", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1", "SENT");

    await makeUseCase(repos).execute("cust-1", request.id, quote.id);

    expect((await repos.quotes.findById(quote.id))?.status).toBe("ACCEPTED");
  });

  it("accepts a VIEWED quote", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1", "VIEWED");

    await makeUseCase(repos).execute("cust-1", request.id, quote.id);

    expect((await repos.quotes.findById(quote.id))?.status).toBe("ACCEPTED");
  });

  it("rejects accepting a WITHDRAWN quote", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1", "WITHDRAWN");

    await expect(makeUseCase(repos).execute("cust-1", request.id, quote.id)).rejects.toThrow();
    expect((await repos.quotes.findById(quote.id))?.status).toBe("WITHDRAWN");
  });

  it("rejects accepting an already-REJECTED quote", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1", "REJECTED");

    await expect(makeUseCase(repos).execute("cust-1", request.id, quote.id)).rejects.toThrow();
  });

  it("rejects accepting an already-ACCEPTED quote", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1", "ACCEPTED");

    await expect(makeUseCase(repos).execute("cust-1", request.id, quote.id)).rejects.toThrow();
  });
});

describe("AcceptQuoteUseCase — ServiceRequest state", () => {
  it("accepts a quote on a PUBLISHED request", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1", "PUBLISHED");
    const quote = await seedQuote(repos, request.id, "pro-1");

    const result = await makeUseCase(repos).execute("cust-1", request.id, quote.id);

    expect(result.serviceRequestId).toBe(request.id);
  });

  it("rejects accepting a quote on an already-ACCEPTED request", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1", "ACCEPTED");
    const quote = await seedQuote(repos, request.id, "pro-1");

    await expect(makeUseCase(repos).execute("cust-1", request.id, quote.id)).rejects.toThrow();
  });

  it.each(["DRAFT", "QUOTED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED", "DISPUTED"] as const)(
    "rejects accepting a quote on a %s request",
    async (status) => {
      const repos = makeRepos();
      const request = await seedPublishedRequest(repos, "cust-1", status);
      const quote = await seedQuote(repos, request.id, "pro-1");

      await expect(makeUseCase(repos).execute("cust-1", request.id, quote.id)).rejects.toThrow();
    },
  );
});

describe("AcceptQuoteUseCase — acceptance transaction", () => {
  it("accepts the selected quote, rejects other open quotes, moves the request to ACCEPTED, and creates one Appointment", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const selected = await seedQuote(repos, request.id, "pro-1", "SENT");
    const competingSent = await seedQuote(repos, request.id, "pro-2", "SENT");
    const competingViewed = await seedQuote(repos, request.id, "pro-3", "VIEWED");
    const alreadyWithdrawn = await seedQuote(repos, request.id, "pro-4", "WITHDRAWN");

    const result = await makeUseCase(repos).execute("cust-1", request.id, selected.id);

    expect((await repos.quotes.findById(selected.id))?.status).toBe("ACCEPTED");
    expect((await repos.quotes.findById(competingSent.id))?.status).toBe("REJECTED");
    expect((await repos.quotes.findById(competingViewed.id))?.status).toBe("REJECTED");
    // Untouched — a WITHDRAWN quote is never (re-)transitioned by acceptance.
    expect((await repos.quotes.findById(alreadyWithdrawn.id))?.status).toBe("WITHDRAWN");

    expect((await repos.serviceRequests.findById(request.id))?.status).toBe("ACCEPTED");

    expect(result.appointment.quoteId).toBe(selected.id);
    expect(result.appointment.serviceRequestId).toBe(request.id);
    expect(result.appointment.status).toBe("PENDING_SCHEDULE");
    expect(result.appointment.scheduledStart).toBeNull();
    expect(repos.quoteAcceptance.appointments.size).toBe(1);
  });

  // Order / Job Lifecycle module (Module 11).
  it("creates exactly one Job, linked to the accepted Quote/ServiceRequest/customer/professional, with status CREATED", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const selected = await seedQuote(repos, request.id, "pro-1", "SENT");

    const result = await makeUseCase(repos).execute("cust-1", request.id, selected.id);

    expect(repos.quoteAcceptance.jobs.size).toBe(1);
    expect(result.job.status).toBe("CREATED");
    expect(result.job.quoteId).toBe(selected.id);
    expect(result.job.serviceRequestId).toBe(request.id);
    expect(result.job.customerId).toBe(request.customerId);
    expect(result.job.professionalProfileId).toBe("pro-1");

    // The initial Appointment created in the same transaction is linked to
    // this same Job.
    expect(result.appointment.jobId).toBe(result.job.id);
  });
});

describe("AcceptQuoteUseCase — invariants", () => {
  it("rejects a second acceptance attempt on the same request (no second ACCEPTED quote, no second Appointment)", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const first = await seedQuote(repos, request.id, "pro-1", "SENT");
    const second = await seedQuote(repos, request.id, "pro-2", "SENT");

    await makeUseCase(repos).execute("cust-1", request.id, first.id);

    // Second attempt — request is no longer PUBLISHED, so this must fail
    // even though `second` is itself still nominally SENT... except it was
    // already rejected by the first acceptance, so this also covers "can't
    // accept an already-REJECTED quote."
    await expect(makeUseCase(repos).execute("cust-1", request.id, second.id)).rejects.toThrow();

    const allQuotes = [await repos.quotes.findById(first.id), await repos.quotes.findById(second.id)];
    expect(allQuotes.filter((q) => q?.status === "ACCEPTED")).toHaveLength(1);
    expect(repos.quoteAcceptance.appointments.size).toBe(1);
    // Order / Job Lifecycle module (Module 11): a second acceptance attempt
    // must not create a second Job either — one accepted Quote, one Job.
    expect(repos.quoteAcceptance.jobs.size).toBe(1);
  });

  it("rejects re-accepting the same quote a second time", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1", "SENT");

    await makeUseCase(repos).execute("cust-1", request.id, quote.id);

    await expect(makeUseCase(repos).execute("cust-1", request.id, quote.id)).rejects.toThrow();
    expect(repos.quoteAcceptance.appointments.size).toBe(1);
    expect(repos.quoteAcceptance.jobs.size).toBe(1);
  });

  it("concurrent acceptance attempts on the same request cannot create more than one Job", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const first = await seedQuote(repos, request.id, "pro-1", "SENT");
    const second = await seedQuote(repos, request.id, "pro-2", "SENT");

    // Fire both acceptance attempts "concurrently" — the fake's own
    // synchronous validate-then-mutate ordering (see FakeQuoteAcceptanceRepository's
    // doc comment) gives the same "only one can win" guarantee the real
    // Prisma transaction's conditional updateMany does.
    const results = await Promise.allSettled([
      makeUseCase(repos).execute("cust-1", request.id, first.id),
      makeUseCase(repos).execute("cust-1", request.id, second.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(repos.quoteAcceptance.jobs.size).toBe(1);
    expect(repos.quoteAcceptance.appointments.size).toBe(1);
  });
});

describe("AcceptQuoteUseCase — atomicity", () => {
  it("leaves quote/request state completely unchanged, with no Appointment, when acceptance is rejected", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1", "SENT");

    // Force the request out of PUBLISHED, simulating a concurrent
    // acceptance having already landed between two calls. The use case's
    // own pre-check rejects this (ValidationError) before ever reaching
    // the atomic repository call — but the guarantee under test is the
    // same one PrismaQuoteAcceptanceRepository's transaction provides:
    // nothing partially applies. No step (Quote status, ServiceRequest
    // status, Appointment creation) ever runs on its own.
    await repos.serviceRequests.updateStatus(request.id, "ACCEPTED");

    await expect(makeUseCase(repos).execute("cust-1", request.id, quote.id)).rejects.toThrow();

    expect((await repos.quotes.findById(quote.id))?.status).toBe("SENT");
    expect(repos.quoteAcceptance.appointments.size).toBe(0);
    expect(repos.quoteAcceptance.jobs.size).toBe(0);
  });

  it("the fake repository itself rejects rather than partially applying when the request state changes underneath it", async () => {
    const repos = makeRepos();
    const request = await seedPublishedRequest(repos, "cust-1");
    const quote = await seedQuote(repos, request.id, "pro-1", "SENT");

    // Bypass the use case's own pre-check entirely and call the repository
    // directly with a request that is no longer PUBLISHED, to prove the
    // atomic operation's own re-verification (not just the use case's) is
    // what ultimately guards against partial writes.
    await repos.serviceRequests.updateStatus(request.id, "ACCEPTED");

    await expect(
      repos.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id }),
    ).rejects.toThrow();

    expect((await repos.quotes.findById(quote.id))?.status).toBe("SENT");
    expect(repos.quoteAcceptance.appointments.size).toBe(0);
    expect(repos.quoteAcceptance.jobs.size).toBe(0);
  });
});
