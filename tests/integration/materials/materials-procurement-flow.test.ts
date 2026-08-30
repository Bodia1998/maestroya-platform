import { describe, expect, it } from "vitest";

import { ConfirmMaterialsPurchasedUseCase } from "@/application/use-cases/quotes/confirm-materials-purchased.use-case";
import { CreateQuoteUseCase } from "@/application/use-cases/quotes/create-quote.use-case";
import { UpdateQuoteUseCase } from "@/application/use-cases/quotes/update-quote.use-case";
import { StartJobUseCase } from "@/application/use-cases/job/start-job.use-case";
import { NullJobNotifier } from "@/application/ports/job-notifier";
import {
  MaterialsListRequiredError,
  MaterialsNotConfirmedError,
  PricedMaterialsNotAllowedError,
} from "@/domain/errors/domain-error";
import {
  FakeAppointmentRepository,
  FakeJobRepository,
  FakeQuoteAcceptanceRepository,
  createAppointmentStore,
  createJobStore,
} from "../booking/fakes";
import {
  FakeCustomerProfileRepository,
  FakeProfessionalDiscoveryRepository,
  FakeProfessionalRepository,
  FakeQuoteRepository,
  FakeServiceRequestDiscoveryRepository,
  FakeServiceRequestRepository,
} from "../quotes/fakes";

/**
 * Module 63 — Materials Procurement Workflow: end-to-end integration
 * coverage across the whole spec'd workflow — real use cases + domain
 * services, fake repositories swapped in for storage, same pattern as
 * every other module's integration tests (see tests/integration/quotes/
 * quote-flows.test.ts and tests/integration/job/job-flows.test.ts, which
 * this file borrows its fakes from directly rather than duplicating them).
 */

const PLUMBING_ID = "cat-plumbing";

function makeRepos() {
  const professionals = new FakeProfessionalRepository();
  const professionalDiscovery = new FakeProfessionalDiscoveryRepository();
  const requestDiscovery = new FakeServiceRequestDiscoveryRepository();
  const quotes = new FakeQuoteRepository();
  const customerProfiles = new FakeCustomerProfileRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const appointmentStore = createAppointmentStore();
  const jobStore = createJobStore();
  const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests, appointmentStore, jobStore);
  const appointments = new FakeAppointmentRepository(appointmentStore);
  const jobs = new FakeJobRepository(jobStore, appointmentStore);
  return {
    professionals,
    professionalDiscovery,
    requestDiscovery,
    quotes,
    customerProfiles,
    serviceRequests,
    quoteAcceptance,
    appointments,
    jobs,
  };
}

type Repos = ReturnType<typeof makeRepos>;

function seedActiveProfessional(repos: Repos, userId: string) {
  const professional = repos.professionals.seed({
    userId,
    status: "ACTIVE",
    // Module 83 — Professional Verification Enforcement: CreateQuoteUseCase
    // now also requires verificationStatus === "VERIFIED".
    verificationStatus: "VERIFIED",
    categoryIds: [PLUMBING_ID],
    serviceRadiusKm: 30,
  });
  repos.professionalDiscovery.seed({
    id: professional.id,
    displayName: "Jane the Plumber",
    businessName: null,
    headline: null,
    yearsExperience: 5,
    hourlyRate: 40,
    serviceRadiusKm: 30,
    verificationStatus: "VERIFIED",
    profileImageUrl: null,
    categoryIds: [PLUMBING_ID],
    latitude: 38.9665,
    longitude: -0.1817,
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

function seedPublishedRequest(repos: Repos, customerUserId: string) {
  const customer = repos.customerProfiles.profiles.get(customerUserId)
    ? repos.customerProfiles.profiles.get(customerUserId)!
    : { id: `customer-of-${customerUserId}`, userId: customerUserId };
  repos.customerProfiles.profiles.set(customer.id, customer);

  const request = repos.serviceRequests.seed({
    id: `request-${customerUserId}-${Math.random().toString(36).slice(2, 8)}`,
    customerId: customer.id,
    categoryId: PLUMBING_ID,
    categoryName: "Plumbing",
    title: "Install a new boiler",
    description: "Replace the old boiler with a condensing model.",
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
      latitude: 38.9214,
      longitude: -0.1174,
    },
    photos: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  repos.requestDiscovery.seed({
    id: request.id,
    title: request.title,
    description: request.description,
    categoryId: request.categoryId,
    categoryName: request.categoryName,
    urgency: request.urgency,
    city: "Oliva",
    province: "Valencia",
    latitude: 38.9214,
    longitude: -0.1174,
    customerUserId,
    createdAt: request.createdAt,
  });

  return request;
}

const VALID_ITEMS = [{ description: "Labor", quantity: 4, unitPrice: 50 }];
const REQUIRED_MATERIALS = [
  { name: "Bosch Condens 2300iW boiler", brand: "Bosch", quantity: 1 },
  { name: "Copper pipe 22mm", quantity: 12 },
];

// Module 78 audit finding fixtures.
const PROFESSIONAL_MATERIALS_ITEMS = [
  { description: "Labor", quantity: 4, unitPrice: 50 },
  { description: "Boiler unit", quantity: 1, unitPrice: 200, category: "MATERIALS" as const },
];
const UNPRICED_MATERIALS_ITEM = [
  { description: "Labor", quantity: 4, unitPrice: 50 },
  { description: "Boiler unit (customer-supplied, not billed)", quantity: 1, unitPrice: 0, category: "MATERIALS" as const },
];

describe("Module 63 — CreateQuoteUseCase materials strategy", () => {
  it("creates a PROFESSIONAL_SUPPLIED quote (default) with no materials list required", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");

    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    expect(quote.materialsStrategy).toBe("PROFESSIONAL_SUPPLIED");
    expect(quote.materials).toHaveLength(0);
    expect(quote.materialsConfirmedAt).toBeNull();
  });

  it("rejects CUSTOMER_PURCHASED with an empty materials list", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");

    await expect(
      new CreateQuoteUseCase(
        repos.professionals,
        repos.professionalDiscovery,
        repos.requestDiscovery,
        repos.quotes,
      ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS, materialsStrategy: "CUSTOMER_PURCHASED", materials: [] }),
    ).rejects.toThrow(MaterialsListRequiredError);
  });

  it("creates a CUSTOMER_PURCHASED quote with a valid required-materials checklist", async () => {
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
      items: VALID_ITEMS,
      materialsStrategy: "CUSTOMER_PURCHASED",
      materials: REQUIRED_MATERIALS,
    });

    expect(quote.materialsStrategy).toBe("CUSTOMER_PURCHASED");
    expect(quote.materials).toHaveLength(2);
    expect(quote.materials[0]?.name).toBe("Bosch Condens 2300iW boiler");
    expect(quote.materialsConfirmedAt).toBeNull();
  });

  it("never persists a materials list for a PROFESSIONAL_SUPPLIED quote even if one is supplied", async () => {
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
      items: VALID_ITEMS,
      materialsStrategy: "PROFESSIONAL_SUPPLIED",
      materials: REQUIRED_MATERIALS,
    });

    expect(quote.materials).toHaveLength(0);
  });
});

describe("Module 78 audit finding — priced MATERIALS items on a CUSTOMER_PURCHASED quote (CreateQuoteUseCase)", () => {
  it("rejects a CUSTOMER_PURCHASED quote that also carries a priced MATERIALS QuoteItem", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");

    await expect(
      new CreateQuoteUseCase(
        repos.professionals,
        repos.professionalDiscovery,
        repos.requestDiscovery,
        repos.quotes,
      ).execute("pro-1", {
        serviceRequestId: request.id,
        items: PROFESSIONAL_MATERIALS_ITEMS,
        materialsStrategy: "CUSTOMER_PURCHASED",
        materials: REQUIRED_MATERIALS,
      }),
    ).rejects.toThrow(PricedMaterialsNotAllowedError);

    // Validation cannot be bypassed by calling the persistence path
    // directly, because the rejection happens before any create() call —
    // confirm nothing was persisted.
    expect(repos.quotes.quotes.size).toBe(0);
  });

  it("accepts a CUSTOMER_PURCHASED quote whose MATERIALS item is unpriced (amount is zero)", async () => {
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
      items: UNPRICED_MATERIALS_ITEM,
      materialsStrategy: "CUSTOMER_PURCHASED",
      materials: REQUIRED_MATERIALS,
    });

    expect(quote.materialsStrategy).toBe("CUSTOMER_PURCHASED");
  });

  it("still accepts a PROFESSIONAL_SUPPLIED quote with a priced MATERIALS item — existing behavior unchanged", async () => {
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
      items: PROFESSIONAL_MATERIALS_ITEMS,
      materialsStrategy: "PROFESSIONAL_SUPPLIED",
    });

    expect(quote.materialsStrategy).toBe("PROFESSIONAL_SUPPLIED");
    expect(quote.totalAmount).toBe(400); // 4*50 labour + 1*200 materials
  });

  it("accepts a CUSTOMER_PURCHASED quote with no MATERIALS items at all", async () => {
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
      items: VALID_ITEMS,
      materialsStrategy: "CUSTOMER_PURCHASED",
      materials: REQUIRED_MATERIALS,
    });

    expect(quote.materialsStrategy).toBe("CUSTOMER_PURCHASED");
  });
});

describe("Module 63 — UpdateQuoteUseCase materials strategy", () => {
  it("preserves the existing materials strategy when the update doesn't specify one", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const created = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", {
      serviceRequestId: request.id,
      items: VALID_ITEMS,
      materialsStrategy: "CUSTOMER_PURCHASED",
      materials: REQUIRED_MATERIALS,
    });

    const updated = await new UpdateQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", created.id, {
      items: VALID_ITEMS,
    });

    expect(updated.materialsStrategy).toBe("CUSTOMER_PURCHASED");
    expect(updated.materials).toHaveLength(2);
  });

  it("rejects switching to CUSTOMER_PURCHASED without a materials list", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const created = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    await expect(
      new UpdateQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", created.id, {
        items: VALID_ITEMS,
        materialsStrategy: "CUSTOMER_PURCHASED",
        materials: [],
      }),
    ).rejects.toThrow(MaterialsListRequiredError);
  });
});

describe("Module 78 audit finding — priced MATERIALS items on a CUSTOMER_PURCHASED quote (UpdateQuoteUseCase)", () => {
  it("rejects switching an existing PROFESSIONAL_SUPPLIED quote to CUSTOMER_PURCHASED while retaining priced MATERIALS items", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const created = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", {
      serviceRequestId: request.id,
      items: PROFESSIONAL_MATERIALS_ITEMS,
      materialsStrategy: "PROFESSIONAL_SUPPLIED",
    });

    await expect(
      new UpdateQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", created.id, {
        items: PROFESSIONAL_MATERIALS_ITEMS,
        materialsStrategy: "CUSTOMER_PURCHASED",
        materials: REQUIRED_MATERIALS,
      }),
    ).rejects.toThrow(PricedMaterialsNotAllowedError);

    // The rejected update must not have mutated the persisted quote.
    const stillPersisted = repos.quotes.quotes.get(created.id);
    expect(stillPersisted?.materialsStrategy).toBe("PROFESSIONAL_SUPPLIED");
  });

  it("rejects adding a priced MATERIALS item to an existing CUSTOMER_PURCHASED quote", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const created = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", {
      serviceRequestId: request.id,
      items: VALID_ITEMS,
      materialsStrategy: "CUSTOMER_PURCHASED",
      materials: REQUIRED_MATERIALS,
    });

    await expect(
      new UpdateQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", created.id, {
        items: PROFESSIONAL_MATERIALS_ITEMS,
        materialsStrategy: "CUSTOMER_PURCHASED",
        materials: REQUIRED_MATERIALS,
      }),
    ).rejects.toThrow(PricedMaterialsNotAllowedError);
  });

  it("still allows a normal PROFESSIONAL_SUPPLIED update with priced MATERIALS items — existing behavior unchanged", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const created = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", {
      serviceRequestId: request.id,
      items: PROFESSIONAL_MATERIALS_ITEMS,
      materialsStrategy: "PROFESSIONAL_SUPPLIED",
    });

    const updated = await new UpdateQuoteUseCase(repos.professionals, repos.quotes).execute("pro-1", created.id, {
      items: PROFESSIONAL_MATERIALS_ITEMS,
    });

    expect(updated.materialsStrategy).toBe("PROFESSIONAL_SUPPLIED");
    expect(updated.totalAmount).toBe(400);
  });
});

describe("Module 63 — ConfirmMaterialsPurchasedUseCase", () => {
  async function seedCustomerPurchasedQuote(repos: Repos) {
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", {
      serviceRequestId: request.id,
      items: VALID_ITEMS,
      materialsStrategy: "CUSTOMER_PURCHASED",
      materials: REQUIRED_MATERIALS,
    });
    return { request, quote };
  }

  it("lets the owning customer confirm the purchase", async () => {
    const repos = makeRepos();
    const { quote } = await seedCustomerPurchasedQuote(repos);

    const confirmed = await new ConfirmMaterialsPurchasedUseCase(
      repos.customerProfiles,
      repos.serviceRequests,
      repos.quotes,
    ).execute("cust-1", quote.id);

    expect(confirmed.materialsConfirmedAt).not.toBeNull();
    expect(confirmed.materialsConfirmedByUserId).toBe("cust-1");
  });

  it("rejects a customer who doesn't own the underlying service request", async () => {
    const repos = makeRepos();
    const { quote } = await seedCustomerPurchasedQuote(repos);

    await expect(
      new ConfirmMaterialsPurchasedUseCase(repos.customerProfiles, repos.serviceRequests, repos.quotes).execute(
        "someone-else",
        quote.id,
      ),
    ).rejects.toThrow();
  });

  it("rejects confirming a PROFESSIONAL_SUPPLIED quote — nothing to confirm", async () => {
    const repos = makeRepos();
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", { serviceRequestId: request.id, items: VALID_ITEMS });

    await expect(
      new ConfirmMaterialsPurchasedUseCase(repos.customerProfiles, repos.serviceRequests, repos.quotes).execute(
        "cust-1",
        quote.id,
      ),
    ).rejects.toThrow();
  });

  it("rejects a second, duplicate confirmation", async () => {
    const repos = makeRepos();
    const { quote } = await seedCustomerPurchasedQuote(repos);
    const useCase = new ConfirmMaterialsPurchasedUseCase(repos.customerProfiles, repos.serviceRequests, repos.quotes);

    await useCase.execute("cust-1", quote.id);

    await expect(useCase.execute("cust-1", quote.id)).rejects.toThrow();
  });
});

describe("Module 63 — StartJobUseCase materials gate", () => {
  async function seedJobFromQuote(
    repos: Repos,
    materialsStrategy: "PROFESSIONAL_SUPPLIED" | "CUSTOMER_PURCHASED",
  ) {
    seedActiveProfessional(repos, "pro-1");
    const request = seedPublishedRequest(repos, "cust-1");
    const quote = await new CreateQuoteUseCase(
      repos.professionals,
      repos.professionalDiscovery,
      repos.requestDiscovery,
      repos.quotes,
    ).execute("pro-1", {
      serviceRequestId: request.id,
      items: VALID_ITEMS,
      materialsStrategy,
      materials: materialsStrategy === "CUSTOMER_PURCHASED" ? REQUIRED_MATERIALS : undefined,
    });
    const result = await repos.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id });
    return { quote, job: result.job };
  }

  it("lets work start immediately for a PROFESSIONAL_SUPPLIED job", async () => {
    const repos = makeRepos();
    const { job } = await seedJobFromQuote(repos, "PROFESSIONAL_SUPPLIED");
    const useCase = new StartJobUseCase(
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      new NullJobNotifier(),
      undefined,
      repos.quotes,
    );

    const started = await useCase.execute("pro-1", job.id);
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("blocks starting work for CUSTOMER_PURCHASED until materials are confirmed", async () => {
    const repos = makeRepos();
    const { job } = await seedJobFromQuote(repos, "CUSTOMER_PURCHASED");
    const useCase = new StartJobUseCase(
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      new NullJobNotifier(),
      undefined,
      repos.quotes,
    );

    await expect(useCase.execute("pro-1", job.id)).rejects.toThrow(MaterialsNotConfirmedError);
  });

  it("allows starting work once the customer confirms the purchase", async () => {
    const repos = makeRepos();
    const { job, quote } = await seedJobFromQuote(repos, "CUSTOMER_PURCHASED");

    await new ConfirmMaterialsPurchasedUseCase(repos.customerProfiles, repos.serviceRequests, repos.quotes).execute(
      "cust-1",
      quote.id,
    );

    const useCase = new StartJobUseCase(
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      new NullJobNotifier(),
      undefined,
      repos.quotes,
    );
    const started = await useCase.execute("pro-1", job.id);
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("skips the gate entirely when no QuoteRepository is supplied (pre-Module-63 construction)", async () => {
    const repos = makeRepos();
    const { job } = await seedJobFromQuote(repos, "CUSTOMER_PURCHASED");
    // No `quotes` argument at all — mirrors every pre-Module-63 caller.
    const useCase = new StartJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, new NullJobNotifier());

    const started = await useCase.execute("pro-1", job.id);
    expect(started.status).toBe("IN_PROGRESS");
  });
});
