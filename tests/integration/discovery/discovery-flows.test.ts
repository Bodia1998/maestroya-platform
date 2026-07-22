import { beforeEach, describe, expect, it } from "vitest";

import { haversineDistanceKm } from "@/domain/services/geo-distance";
import { GetProfessionalPublicProfileUseCase } from "@/application/use-cases/discovery/get-professional-public-profile.use-case";
import { SearchProfessionalsUseCase } from "@/application/use-cases/discovery/search-professionals.use-case";
import {
  FakeProfessionalDiscoveryRepository,
  FakeServiceCategoryRepository,
} from "./fakes";
import type { FakeDiscoverableProfessional } from "./fakes";

const ELECTRICIAN_ID = "11111111-1111-1111-1111-111111111111";
const PLUMBER_ID = "22222222-2222-2222-2222-222222222222";

// Customer's searched location — matches the module spec's "Gandia" example.
const SEARCH_POINT = { latitude: 38.9665, longitude: -0.1817 };

// Real nearby town, used as "Professional A"'s base in the spec's example.
const NEARBY_POINT = { latitude: 38.9214, longitude: -0.1174 }; // ~Oliva
// A further-away real town, used as "Professional C"'s base in the spec's example.
const FAR_POINT = { latitude: 38.8407, longitude: 0.1058 }; // ~Denia

function professional(overrides: Partial<FakeDiscoverableProfessional>): FakeDiscoverableProfessional {
  return {
    id: "professional-id",
    displayName: "Professional",
    businessName: null,
    headline: null,
    yearsExperience: null,
    hourlyRate: null,
    serviceRadiusKm: null,
    verificationStatus: "UNVERIFIED",
    profileImageUrl: null,
    categoryIds: [],
    latitude: null,
    longitude: null,
    status: "ACTIVE",
    bio: null,
    city: null,
    province: null,
    ...overrides,
  };
}

describe("SearchProfessionalsUseCase", () => {
  let discovery: FakeProfessionalDiscoveryRepository;
  let categories: FakeServiceCategoryRepository;

  beforeEach(() => {
    discovery = new FakeProfessionalDiscoveryRepository();
    categories = new FakeServiceCategoryRepository();
    categories.seed({ id: ELECTRICIAN_ID, name: "Electrician", slug: "electrician" });
    categories.seed({ id: PLUMBER_ID, name: "Plumber", slug: "plumber" });
  });

  it("searches by service category and returns only active professionals offering it", async () => {
    discovery.seed(
      professional({
        id: "pro-electrician",
        categoryIds: [ELECTRICIAN_ID],
        latitude: NEARBY_POINT.latitude,
        longitude: NEARBY_POINT.longitude,
        serviceRadiusKm: 50,
      }),
    );

    const result = await new SearchProfessionalsUseCase(discovery, categories).execute({
      categoryId: ELECTRICIAN_ID,
      latitude: SEARCH_POINT.latitude,
      longitude: SEARCH_POINT.longitude,
      page: 1,
      pageSize: 20,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.id).toBe("pro-electrician");
  });

  it("does not return an inactive professional", async () => {
    discovery.seed(
      professional({
        id: "pro-inactive",
        status: "INACTIVE",
        categoryIds: [ELECTRICIAN_ID],
        latitude: NEARBY_POINT.latitude,
        longitude: NEARBY_POINT.longitude,
        serviceRadiusKm: 50,
      }),
    );

    const result = await new SearchProfessionalsUseCase(discovery, categories).execute({
      categoryId: ELECTRICIAN_ID,
      latitude: SEARCH_POINT.latitude,
      longitude: SEARCH_POINT.longitude,
      page: 1,
      pageSize: 20,
    });

    expect(result.results).toHaveLength(0);
  });

  it("does not return a professional whose distance exceeds their own service radius", async () => {
    const distance = haversineDistanceKm(SEARCH_POINT, FAR_POINT);
    discovery.seed(
      professional({
        id: "pro-out-of-radius",
        categoryIds: [ELECTRICIAN_ID],
        latitude: FAR_POINT.latitude,
        longitude: FAR_POINT.longitude,
        serviceRadiusKm: Math.max(0, distance - 1), // deliberately too small
      }),
    );

    const result = await new SearchProfessionalsUseCase(discovery, categories).execute({
      categoryId: ELECTRICIAN_ID,
      latitude: SEARCH_POINT.latitude,
      longitude: SEARCH_POINT.longitude,
      page: 1,
      pageSize: 20,
    });

    expect(result.results).toHaveLength(0);
  });

  it("returns a professional whose distance is within their own service radius", async () => {
    const distance = haversineDistanceKm(SEARCH_POINT, FAR_POINT);
    discovery.seed(
      professional({
        id: "pro-in-radius",
        categoryIds: [ELECTRICIAN_ID],
        latitude: FAR_POINT.latitude,
        longitude: FAR_POINT.longitude,
        serviceRadiusKm: distance + 5, // comfortably covers the distance
      }),
    );

    const result = await new SearchProfessionalsUseCase(discovery, categories).execute({
      categoryId: ELECTRICIAN_ID,
      latitude: SEARCH_POINT.latitude,
      longitude: SEARCH_POINT.longitude,
      page: 1,
      pageSize: 20,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.id).toBe("pro-in-radius");
  });

  it("orders results by distance ascending, evaluating each professional's own radius individually", async () => {
    // Matches the module spec's worked example: A is near and well within
    // its radius, B is excluded by its own (small) radius, C is farther
    // but still within its own (larger) radius, so the final order is A, C.
    const distanceToNearby = haversineDistanceKm(SEARCH_POINT, NEARBY_POINT);
    const distanceToFar = haversineDistanceKm(SEARCH_POINT, FAR_POINT);

    discovery.seed(
      professional({
        id: "professional-a",
        categoryIds: [ELECTRICIAN_ID],
        latitude: NEARBY_POINT.latitude,
        longitude: NEARBY_POINT.longitude,
        serviceRadiusKm: distanceToNearby + 25, // e.g. ~30km radius, well inside
      }),
    );
    discovery.seed(
      professional({
        id: "professional-b-excluded",
        categoryIds: [ELECTRICIAN_ID],
        latitude: FAR_POINT.latitude,
        longitude: FAR_POINT.longitude,
        serviceRadiusKm: Math.max(0, distanceToFar - 10), // too small — excluded
      }),
    );
    discovery.seed(
      professional({
        id: "professional-c",
        categoryIds: [ELECTRICIAN_ID],
        latitude: FAR_POINT.latitude,
        longitude: FAR_POINT.longitude,
        serviceRadiusKm: distanceToFar + 25, // large enough — included
      }),
    );

    const result = await new SearchProfessionalsUseCase(discovery, categories).execute({
      categoryId: ELECTRICIAN_ID,
      latitude: SEARCH_POINT.latitude,
      longitude: SEARCH_POINT.longitude,
      page: 1,
      pageSize: 20,
    });

    expect(result.results.map((r) => r.id)).toEqual(["professional-a", "professional-c"]);
    expect(result.results[0]!.distanceKm).toBeLessThanOrEqual(result.results[1]!.distanceKm);
  });

  it("does not return a professional registered under a different service category", async () => {
    discovery.seed(
      professional({
        id: "pro-plumber",
        categoryIds: [PLUMBER_ID],
        latitude: NEARBY_POINT.latitude,
        longitude: NEARBY_POINT.longitude,
        serviceRadiusKm: 50,
      }),
    );

    const result = await new SearchProfessionalsUseCase(discovery, categories).execute({
      categoryId: ELECTRICIAN_ID,
      latitude: SEARCH_POINT.latitude,
      longitude: SEARCH_POINT.longitude,
      page: 1,
      pageSize: 20,
    });

    expect(result.results).toHaveLength(0);
  });

  it("excludes a professional with no configured service radius", async () => {
    discovery.seed(
      professional({
        id: "pro-no-radius",
        categoryIds: [ELECTRICIAN_ID],
        latitude: NEARBY_POINT.latitude,
        longitude: NEARBY_POINT.longitude,
        serviceRadiusKm: null,
      }),
    );

    const result = await new SearchProfessionalsUseCase(discovery, categories).execute({
      categoryId: ELECTRICIAN_ID,
      latitude: SEARCH_POINT.latitude,
      longitude: SEARCH_POINT.longitude,
      page: 1,
      pageSize: 20,
    });

    expect(result.results).toHaveLength(0);
  });

  it("excludes a professional with no base coordinates yet", async () => {
    discovery.seed(
      professional({
        id: "pro-no-address",
        categoryIds: [ELECTRICIAN_ID],
        latitude: null,
        longitude: null,
        serviceRadiusKm: 50,
      }),
    );

    const result = await new SearchProfessionalsUseCase(discovery, categories).execute({
      categoryId: ELECTRICIAN_ID,
      latitude: SEARCH_POINT.latitude,
      longitude: SEARCH_POINT.longitude,
      page: 1,
      pageSize: 20,
    });

    expect(result.results).toHaveLength(0);
  });

  it("rejects a search for an unknown/inactive service category", async () => {
    await expect(
      new SearchProfessionalsUseCase(discovery, categories).execute({
        categoryId: "99999999-9999-9999-9999-999999999999",
        latitude: SEARCH_POINT.latitude,
        longitude: SEARCH_POINT.longitude,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow();
  });
});

describe("GetProfessionalPublicProfileUseCase", () => {
  let discovery: FakeProfessionalDiscoveryRepository;

  beforeEach(() => {
    discovery = new FakeProfessionalDiscoveryRepository();
  });

  it("returns only the safe public fields for an active professional", async () => {
    discovery.seed(
      professional({
        id: "pro-public",
        displayName: "Ana García",
        businessName: "Ana's Electric",
        headline: "Licensed electrician",
        bio: "10 years fixing homes.",
        yearsExperience: 10,
        hourlyRate: 45,
        serviceRadiusKm: 30,
        verificationStatus: "VERIFIED",
        categoryIds: [ELECTRICIAN_ID],
        city: "Gandia",
        province: "Valencia",
      }),
    );

    const profile = await new GetProfessionalPublicProfileUseCase(discovery).execute("pro-public");

    expect(profile).toEqual({
      id: "pro-public",
      displayName: "Ana García",
      businessName: "Ana's Electric",
      headline: "Licensed electrician",
      bio: "10 years fixing homes.",
      yearsExperience: 10,
      hourlyRate: 45,
      serviceRadiusKm: 30,
      verificationStatus: "VERIFIED",
      profileImageUrl: null,
      categoryIds: [ELECTRICIAN_ID],
      city: "Gandia",
      province: "Valencia",
    });
    // Explicitly assert none of the sensitive/internal fields ever leak
    // through the public DTO shape.
    expect(profile).not.toHaveProperty("contactEmail");
    expect(profile).not.toHaveProperty("contactPhone");
    expect(profile).not.toHaveProperty("taxId");
    expect(profile).not.toHaveProperty("latitude");
    expect(profile).not.toHaveProperty("longitude");
    expect(profile).not.toHaveProperty("status");
  });

  it("throws NotFoundError for an inactive professional's profile", async () => {
    discovery.seed(professional({ id: "pro-inactive", status: "INACTIVE" }));

    await expect(
      new GetProfessionalPublicProfileUseCase(discovery).execute("pro-inactive"),
    ).rejects.toThrow();
  });

  it("throws NotFoundError for an unknown professional id", async () => {
    await expect(
      new GetProfessionalPublicProfileUseCase(discovery).execute("does-not-exist"),
    ).rejects.toThrow();
  });
});
