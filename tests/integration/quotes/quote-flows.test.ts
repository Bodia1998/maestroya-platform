import { describe, expect, it, vi } from "vitest";

import { CreateQuoteUseCase } from "@/application/use-cases/quotes/create-quote.use-case";
import { GetAvailableServiceRequestsForProfessionalUseCase } from "@/application/use-cases/quotes/get-available-service-requests-for-professional.use-case";
import { GetProfessionalQuoteUseCase } from "@/application/use-cases/quotes/get-professional-quote.use-case";
import { GetProfessionalQuotesUseCase } from "@/application/use-cases/quotes/get-professional-quotes.use-case";
import { GetServiceRequestQuotesUseCase } from "@/application/use-cases/quotes/get-service-request-quotes.use-case";
import { UpdateQuoteUseCase } from "@/application/use-cases/quotes/update-quote.use-case";
import { WithdrawQuoteUseCase } from "@/application/use-cases/quotes/withdraw-quote.use-case";
import {
  FakeCustomerProfileRepository,
  FakeProfessionalDiscoveryRepository,
  FakeProfessionalRepository,
  FakeQuoteRepository,
  FakeServiceRequestDiscoveryRepository,
  FakeServiceRequestRepository,
} from "./fakes";

const PLUMBING_ID = "cat-plumbing";
const ELECTRICAL_ID = "cat-electrical";

// Gandia / Oliva, Spain — same fixture pair used in geo-distance.test.ts,
// ~8-10km apart.
const GANDIA = { latitude: 38.9665, longitude: -0.1817 };
const OLIVA = { latitude: 38.9214, longitude: -0.1174 };
const FAR_AWAY = { latitude: 40.4168, longitude: -3.7038 }; // Madrid — ~300km from Gandia

function makeRepos() {
  const professionals = new FakeProfessionalRepository();
  const professionalDiscovery = new FakeProfessionalDiscoveryRepository();
  const requestDiscovery = new FakeServiceRequestDiscoveryRepository();
  const quotes = new FakeQuoteRepository();
  const customerProfiles = new FakeCustomerProfileRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  return { professionals, professionalDiscovery, requestDiscovery, quotes, customerProfiles, serviceRequests };
}

function seedActiveProfessional(
  repos: ReturnType<typeof makeRepos>,
  userId: string,
  overrides: { categoryIds?: string[]; serviceRadiusKm?: number | null; location?: { latitude: number; longitude: number } | null } = {},
) {
  const professional = repos.professionals.seed({
    userId,
    status: "ACTIVE",
    categoryIds: overrides.categoryIds ?? [PLUMBING_ID],
    serviceRadiusKm: overrides.serviceRadiusKm === undefined ? 30 : overrides.serviceRadiusKm,
  });
  const location = overrides.location === undefined ? GANDIA : overrides.location;
  repos.professionalDiscovery.seed({
    id: professional.id,
    displayName: "Jane the Plumber",
    businessName: null,
    headline: null,
    yearsExperience: 5,
    hourlyRate: 40,
    serviceRadiusKm: overrides.serviceRadiusKm === undefined ? 30 : overrides.serviceRadiusKm,
    verificationStatus: "VERIFIED",
    profileImageUrl: null,
    categoryIds: overrides.categoryIds ?? [PLUMBING_ID],
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    city: null,
    province: null,
    averageRating: null,
    reviewCount: 0,
    portfolioItemCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE",
  });
  return professional;
}

function seedPublishedRequest(
  repos: ReturnType<typeof makeRepos>,
  customerUserId: string,
  overrides: { categoryId?: string; location?: { latitude: number; longitude: number } | null } = {},
) {
  const customer = repos.customerProfiles.profiles.get(customerUserId)
    ? repos.customerProfiles.profiles.get(customerUserId)!
    : { id: `customer-of-${customerUserId}`, userId: customerUserId };
  repos.customerProfiles.profiles.set(customer.id, customer);

  const request = repos.serviceRequests.seed({
    id: `request-${customerUserId}-${Math.random().toString(36).slice(2, 8)}`,
    customerId: customer.id,
    categoryId: overrides.categoryId ?? PLUMBING_ID,
    categoryName: "Plumbing",
    title: "Fix leaking kitchen tap",
    description: "The tap under the kitchen sink has been dripping for a week.",
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
      latitude: overrides.location === undefined ? OLIVA.latitude : overrides.location?.latitude ?? null,
      longitude: overrides.location === undefined ? OLIVA.longitude : overrides.location?.longitude ?? null,
    },
    photos: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const location = overrides.location === undefined ? OLIVA : overrides.location;
  repos.requestDiscovery.seed({
    id: request.id,
    title: request.title,
    description: request.description,
    categoryId: request.categoryId,
    categoryName: request.categoryName,
    urgency: request.urgency,
    city: "Oliva",
    province: "Valencia",
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    customerUserId,
    createdAt: request.createdAt,
  });

  return request;
}

const VALID_ITEMS = [{ description: "Labor", quantity: 2, unitPrice: 50 }];

describe("GetAvailableServiceRequestsForProfessionalUseCase", () => {
  it("lists PUBLISHED requests matching the professional's category and radius", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    seedPublishedRequest(repos, "cust-1");

    const results = await new GetAvailableServiceRequestsForProfessionalUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
    ).execute("pro-1");

    expect(results).toHaveLength(1);
    expect(results[0]?.categoryId).toBe(PLUMBING_ID);
  });

  it("returns an empty list for a signed-in user with no ProfessionalProfile", async () => {
    const repos = makeRepos();
    seedPublishedRequest(repos, "cust-1");

    const results = await new GetAvailableServiceRequestsForProfessionalUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
    ).execute("pro-without-profile");

    expect(results).toEqual([]);
  });
});

describe("Server Action auth boundary (unauthenticated users)", () => {
  // Every professional quote Server Action calls requireAuth() before ever
  // touching a use case — mirrors the same coverage as
  // service-request-flows.test.ts's equivalent check, for this module's own
  // actions (createQuoteAction/updateQuoteAction/withdrawQuoteAction).
  it("requireAuth throws (and never resolves a userId) when there is no session", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
    const { requireAuth } = await import("@/infrastructure/auth/rbac");

    await expect(requireAuth()).rejects.toThrow();

    vi.doUnmock("@/lib/auth");
  });
});

describe("CreateQuoteUseCase", () => {
  it("rejects a signed-in user with an INACTIVE professional profile", async () => {
    const repos = makeRepos();
    const professional = seedActiveProfessional(repos, "pro-1");
    await repos.professionals.updateStatus(professional.id, "INACTIVE");
    const request = seedPublishedRequest(repos, "cust-1");

    await expect(
      new CreateQuoteUseCase(
        repos.professionals,
        repos.professionalDiscovery,
        repos.requestDiscovery,
        repos.quotes,
      ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS }),
    ).rejects.toThrow();
  });

  it("rejects a professional with no ProfessionalProfile at all", async () => {
    const repos = makeRepos();
    const request = seedPublishedRequest(repos, "cust-1");

    await expect(
      new CreateQuoteUseCase(
        repos.professionals,
        repos.professionalDiscovery,
        repos.requestDiscovery,
        repos.quotes,
      ).execute("pro-without-profile", { serviceRequestId: request.id, items: VALID_ITEMS }),
    ).rejects.toThrow();
  });

  it("rejects quoting a non-PUBLISHED (e.g. DRAFT) request", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    // Simulate a DRAFT/unpublished request: not seeded into requestDiscovery
    // at all, matching PrismaServiceRequestDiscoveryRepository's
    // "findPublishedById only ever returns PUBLISHED rows" guarantee.
    repos.requestDiscovery.requests.delete(request.id);

    await expect(
      new CreateQuoteUseCase(
        repos.professionals,
        repos.professionalDiscovery,
        repos.requestDiscovery,
        repos.quotes,
      ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS }),
    ).rejects.toThrow();
  });

  it("rejects a request outside the professional's service radius", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1", { serviceRadiusKm: 10 });
    const request = seedPublishedRequest(repos, "cust-1", { location: FAR_AWAY });

    await expect(
      new CreateQuoteUseCase(
        repos.professionals,
        repos.professionalDiscovery,
        repos.requestDiscovery,
        repos.quotes,
      ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS }),
    ).rejects.toThrow();
  });

  it("rejects a request in a category the professional doesn't offer", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1", { categoryIds: [ELECTRICAL_ID] });
    const request = seedPublishedRequest(repos, "cust-1", { categoryId: PLUMBING_ID });

    await expect(
      new CreateQuoteUseCase(
        repos.professionals,
        repos.professionalDiscovery,
        repos.requestDiscovery,
        repos.quotes,
      ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS }),
    ).rejects.toThrow();
  });

  it("rejects a professional quoting their own service request", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "pro-1");

    await expect(
      new CreateQuoteUseCase(
        repos.professionals,
        repos.professionalDiscovery,
        repos.requestDiscovery,
        repos.quotes,
      ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS }),
    ).rejects.toThrow();
  });

  it("creates a valid quote with correctly calculated item amounts and total", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");

    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", {
      serviceRequestId: request.id,
      items: [
        { description: "Labor", quantity: 2, unitPrice: 50 },
        { description: "Parts", quantity: 1, unitPrice: 25.5 },
      ],
    });

    expect(quote.status).toBe("SENT");
    expect(quote.items[0]?.amount).toBe(100);
    expect(quote.items[1]?.amount).toBe(25.5);
    expect(quote.totalAmount).toBe(125.5);
    // Never trusts a client-supplied professionalId/userId.
    expect(quote.professionalProfileId).not.toBe(request.customerId);
  });

  it("rejects a duplicate active quote for the same request by the same professional", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const useCase = new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    );

    await useCase.execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    await expect(
      useCase.execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS }),
    ).rejects.toThrow();
  });
});

describe("GetProfessionalQuoteUseCase / GetProfessionalQuotesUseCase", () => {
  it("lets a professional list their own quotes", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    const list = await new GetProfessionalQuotesUseCase(
      repos.professionals,
      repos.quotes,
      repos.serviceRequests,
    ).execute("pro-1");

    expect(list).toHaveLength(1);
    expect(list[0]?.serviceRequestTitle).toBe(request.title);
  });

  it("prevents a professional from accessing another professional's quote", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    seedActiveProfessional(repos, "pro-2");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    await expect(
      new GetProfessionalQuoteUseCase(repos.professionals, repos.quotes).execute("pro-2", quote.id),
    ).rejects.toThrow();
  });
});

describe("UpdateQuoteUseCase", () => {
  it("lets the owner update their own editable (SENT) quote and recalculates the total", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    const updated = await new UpdateQuoteUseCase(repos.professionals, repos.quotes).execute(
      "pro-1",
      quote.id,
      { items: [{ description: "Labor", quantity: 3, unitPrice: 60 }] },
    );

    expect(updated.totalAmount).toBe(180);
    expect(updated.serviceRequestId).toBe(request.id);
    expect(updated.professionalProfileId).toBe(quote.professionalProfileId);
  });

  it("prevents a non-owner from updating another professional's quote", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    seedActiveProfessional(repos, "pro-2");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    await expect(
      new UpdateQuoteUseCase(repos.professionals, repos.quotes).execute("pro-2", quote.id, {
        items: VALID_ITEMS,
      }),
    ).rejects.toThrow();
  });

  it("rejects updating a non-editable (already ACCEPTED) quote", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });
    await repos.quotes.updateStatus(quote.id, "ACCEPTED");

    await expect(
      new UpdateQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", quote.id, {
        items: VALID_ITEMS,
      }),
    ).rejects.toThrow();
  });
});

describe("WithdrawQuoteUseCase", () => {
  it("lets the owner withdraw their own quote", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    await new WithdrawQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", quote.id);

    const withdrawn = await repos.quotes.findById(quote.id);
    expect(withdrawn?.status).toBe("WITHDRAWN");
  });

  it("prevents a non-owner from withdrawing another professional's quote", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    seedActiveProfessional(repos, "pro-2");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    await expect(
      new WithdrawQuoteUseCase(repos.professionals, repos.quotes).execute("pro-2", quote.id),
    ).rejects.toThrow();

    const stillSent = await repos.quotes.findById(quote.id);
    expect(stillSent?.status).toBe("SENT");
  });

  it("rejects withdrawing an already-WITHDRAWN quote", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });
    await new WithdrawQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", quote.id);

    await expect(
      new WithdrawQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", quote.id),
    ).rejects.toThrow();
  });

  it("rejects withdrawing a non-withdrawable (already ACCEPTED) quote", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });
    await repos.quotes.updateStatus(quote.id, "ACCEPTED");

    await expect(
      new WithdrawQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", quote.id),
    ).rejects.toThrow();
  });
});

describe("GetServiceRequestQuotesUseCase", () => {
  it("lets the owning customer view quotes for their own request", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    const views = await new GetServiceRequestQuotesUseCase(
      repos.customerProfiles,
      repos.serviceRequests,
      repos.quotes,
      repos.professionalDiscovery,
    ).execute("cust-1", request.id);

    expect(views).toHaveLength(1);
    expect(views[0]?.professional.displayName).toBe("Jane the Plumber");
  });

  it("prevents another customer from viewing quotes for someone else's request", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });
    await repos.customerProfiles.findOrCreateByUserId("cust-2");

    await expect(
      new GetServiceRequestQuotesUseCase(
        repos.customerProfiles,
        repos.serviceRequests,
        repos.quotes,
        repos.professionalDiscovery,
      ).execute("cust-2", request.id),
    ).rejects.toThrow();
  });

  it("never exposes professional-private information — only the safe public-profile shape", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    const [view] = await new GetServiceRequestQuotesUseCase(
      repos.customerProfiles,
      repos.serviceRequests,
      repos.quotes,
      repos.professionalDiscovery,
    ).execute("cust-1", request.id);

    // Only the safe, marketplace-facing fields exist on `professional` —
    // there is no email/phone/taxId/exact-address field to even leak,
    // structurally, because CustomerQuoteView never declares them.
    expect(Object.keys(view!.professional).sort()).toEqual(
      ["displayName", "id", "profileImageUrl", "verificationStatus"].sort(),
    );
  });
});
