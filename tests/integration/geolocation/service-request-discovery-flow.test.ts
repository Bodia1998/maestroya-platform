import { describe, expect, it } from "vitest";

import { CreateServiceRequestUseCase } from "@/application/use-cases/service-request/create-service-request.use-case";
import { GetAvailableServiceRequestsForProfessionalUseCase } from "@/application/use-cases/quotes/get-available-service-requests-for-professional.use-case";
import { createGeocodingProvider } from "@/infrastructure/geocoding/geocoding-provider-factory";
import {
  FakeProfessionalDiscoveryRepository,
  FakeProfessionalRepository,
  FakeServiceRequestDiscoveryRepository,
} from "../quotes/fakes";
import {
  FakeCustomerProfileRepository,
  FakeServiceCategoryRepository,
  FakeServiceRequestRepository,
} from "../service-request/fakes";

/**
 * Module 27 — Spain Location Services — end-to-end regression test.
 *
 * Every other integration test in this codebase either exercises
 * `CreateServiceRequestUseCase` in isolation (`service-request-flows.test.ts`,
 * with a `FakeGeocodingProvider` that returns a hardcoded point) or
 * exercises `GetAvailableServiceRequestsForProfessionalUseCase` in
 * isolation (`quote-flows.test.ts`, with coordinates seeded directly into
 * `ServiceRequestDiscoveryRepository`, bypassing geocoding entirely). Both
 * are valuable, narrower tests, but neither proves the actual seam this
 * module hardens: that a coordinate the *real* `createGeocodingProvider()`
 * chain (factory → Safe → Cached → `StaticCityGeocodingProvider`, the
 * production default) resolves is the same coordinate that ends up
 * driving professional discovery.
 *
 * This test wires the real production geocoding provider (not a fake) all
 * the way through:
 *
 *   customer submits a request (city only, no lat/lng)
 *     → CreateServiceRequestUseCase geocodes it via createGeocodingProvider()
 *     → the resolved coordinate is what gets persisted on the request
 *     → that same persisted coordinate feeds the discovery read-model
 *       (mirroring the "two repositories, one underlying row" relationship
 *       ServiceRequestRepository/ServiceRequestDiscoveryRepository have in
 *       production — see FakeServiceRequestDiscoveryRepository's own doc
 *       comment)
 *     → a professional with a matching category and a base location
 *       geocoded through the exact same provider sees the request in
 *       GetAvailableServiceRequestsForProfessionalUseCase's results.
 */
describe("Module 27 — geocoding → professional discovery (end-to-end)", () => {
  it("a request geocoded via the real default provider is discoverable by a matching, correctly-located professional", async () => {
    const categories = new FakeServiceCategoryRepository();
    const category = categories.seed({ id: "cat-plumbing", name: "Plumbing", slug: "plumbing" });

    const customerProfiles = new FakeCustomerProfileRepository();
    const serviceRequests = new FakeServiceRequestRepository(categories);
    // The real production factory — GEOCODING_PROVIDER is unset/STATIC in
    // the test environment, so this resolves to
    // Safe(Cached(StaticCityGeocodingProvider)), exactly what runs in
    // production today. Not a fake.
    const geocoding = createGeocodingProvider();

    const createServiceRequest = new CreateServiceRequestUseCase(
      serviceRequests,
      customerProfiles,
      categories,
      geocoding,
    );

    const request = await createServiceRequest.execute("user-customer-1", {
      categoryId: category.id,
      title: "Fix leaking kitchen tap",
      description: "The tap under the kitchen sink has been dripping for a week.",
      urgency: "MEDIUM",
      location: {
        line1: "Calle Mayor 1",
        city: "Valencia",
        province: "Valencia",
        postalCode: "46001",
        country: "ES",
      },
    });

    // The geocoding layer actually resolved a coordinate — the whole point
    // of this test would be meaningless if it hadn't.
    expect(request.location.latitude).not.toBeNull();
    expect(request.location.longitude).not.toBeNull();
    expect(request.location.latitude).toBeCloseTo(39.4699, 1);
    expect(request.location.longitude).toBeCloseTo(-0.3763, 1);

    // Mirrors the request into the discovery read-model using the
    // coordinates CreateServiceRequestUseCase's own geocoding call actually
    // produced — never a separately-hardcoded value — exactly like
    // PrismaServiceRequestDiscoveryRepository reads the same persisted
    // Address/ServiceRequest row CreateServiceRequestUseCase just wrote.
    const requestDiscovery = new FakeServiceRequestDiscoveryRepository();
    requestDiscovery.seed({
      id: request.id,
      title: request.title,
      description: request.description,
      categoryId: request.categoryId,
      categoryName: request.categoryName,
      urgency: request.urgency,
      city: request.location.city,
      province: request.location.province,
      latitude: request.location.latitude,
      longitude: request.location.longitude,
      customerUserId: "user-customer-1",
      createdAt: request.createdAt,
    });

    // The professional's own base location is geocoded through the exact
    // same provider instance — proving both sides of a real match resolve
    // through the identical geocoding layer, not two different fixtures
    // that happen to agree.
    const professionalPoint = await geocoding.geocode({ city: "Valencia", province: "Valencia" });
    expect(professionalPoint).not.toBeNull();

    const professionals = new FakeProfessionalRepository();
    const professional = professionals.seed({
      userId: "user-pro-1",
      status: "ACTIVE",
      categoryIds: [category.id],
      serviceRadiusKm: 30,
    });

    const professionalDiscovery = new FakeProfessionalDiscoveryRepository();
    professionalDiscovery.seed({
      id: professional.id,
      status: "ACTIVE",
      displayName: "Jane the Plumber",
      businessName: null,
      headline: null,
      yearsExperience: 5,
      hourlyRate: 40,
      serviceRadiusKm: 30,
      verificationStatus: "VERIFIED",
      profileImageUrl: null,
      categoryIds: [category.id],
      latitude: professionalPoint!.latitude,
      longitude: professionalPoint!.longitude,
      city: "Valencia",
      province: "Valencia",
      averageRating: null,
      reviewCount: 0,
      portfolioItemCount: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const availableRequests = await new GetAvailableServiceRequestsForProfessionalUseCase(
      professionals,
      professionalDiscovery,
      requestDiscovery,
    ).execute("user-pro-1");

    expect(availableRequests.map((r) => r.id)).toContain(request.id);
    expect(availableRequests.find((r) => r.id === request.id)?.categoryId).toBe(category.id);
  });

  it("a request in a city the default provider can't resolve gets null coordinates and stays invisible to discovery", async () => {
    const categories = new FakeServiceCategoryRepository();
    const category = categories.seed({ id: "cat-plumbing", name: "Plumbing", slug: "plumbing" });

    const customerProfiles = new FakeCustomerProfileRepository();
    const serviceRequests = new FakeServiceRequestRepository(categories);
    const geocoding = createGeocodingProvider();

    const request = await new CreateServiceRequestUseCase(
      serviceRequests,
      customerProfiles,
      categories,
      geocoding,
    ).execute("user-customer-2", {
      categoryId: category.id,
      title: "Fix a leaking pipe",
      description: "Same issue, unrecognized town.",
      urgency: "MEDIUM",
      location: {
        line1: "Calle Falsa 123",
        city: "Not A Real Town 98765",
        postalCode: "00000",
        country: "ES",
      },
    });

    // Request creation itself must never fail — it just degrades
    // discoverability for this one request, exactly as documented.
    expect(request.location.latitude).toBeNull();
    expect(request.location.longitude).toBeNull();

    const requestDiscovery = new FakeServiceRequestDiscoveryRepository();
    requestDiscovery.seed({
      id: request.id,
      title: request.title,
      description: request.description,
      categoryId: request.categoryId,
      categoryName: request.categoryName,
      urgency: request.urgency,
      city: request.location.city,
      province: request.location.province,
      latitude: request.location.latitude,
      longitude: request.location.longitude,
      customerUserId: "user-customer-2",
      createdAt: request.createdAt,
    });

    const professionalPoint = await geocoding.geocode({ city: "Valencia", province: "Valencia" });

    const professionals = new FakeProfessionalRepository();
    const professional = professionals.seed({
      userId: "user-pro-2",
      status: "ACTIVE",
      categoryIds: [category.id],
      serviceRadiusKm: 30,
    });

    const professionalDiscovery = new FakeProfessionalDiscoveryRepository();
    professionalDiscovery.seed({
      id: professional.id,
      status: "ACTIVE",
      displayName: "Jane the Plumber",
      businessName: null,
      headline: null,
      yearsExperience: 5,
      hourlyRate: 40,
      serviceRadiusKm: 30,
      verificationStatus: "VERIFIED",
      profileImageUrl: null,
      categoryIds: [category.id],
      latitude: professionalPoint!.latitude,
      longitude: professionalPoint!.longitude,
      city: "Valencia",
      province: "Valencia",
      averageRating: null,
      reviewCount: 0,
      portfolioItemCount: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const availableRequests = await new GetAvailableServiceRequestsForProfessionalUseCase(
      professionals,
      professionalDiscovery,
      requestDiscovery,
    ).execute("user-pro-2");

    expect(availableRequests.map((r) => r.id)).not.toContain(request.id);
  });
});
