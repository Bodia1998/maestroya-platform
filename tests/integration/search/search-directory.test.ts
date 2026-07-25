import { beforeEach, describe, expect, it } from "vitest";

import { SearchDirectoryUseCase } from "@/application/use-cases/search/search-directory.use-case";
import {
  FakeSearchableCompanyDiscoveryRepository,
  FakeSearchableProfessionalDiscoveryRepository,
  FakeServiceCategoryRepository,
} from "./fakes";
import type { FakeSearchableCompany, FakeSearchableProfessional } from "./fakes";

const ELECTRICIAN_ID = "11111111-1111-1111-1111-111111111111";
const PLUMBER_ID = "22222222-2222-2222-2222-222222222222";

const FIXED_NOW = new Date("2026-07-25T00:00:00.000Z");

function professional(overrides: Partial<FakeSearchableProfessional> & { id: string }): FakeSearchableProfessional {
  return {
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
    city: null,
    province: null,
    averageRating: null,
    reviewCount: 0,
    portfolioItemCount: 0,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  };
}

function company(overrides: Partial<FakeSearchableCompany> & { id: string }): FakeSearchableCompany {
  return {
    displayName: "Company",
    legalName: "Company S.L.",
    description: null,
    logoUrl: null,
    isVerified: false,
    averageRating: null,
    reviewCount: 0,
    categoryIds: [],
    city: null,
    province: null,
    latitude: null,
    longitude: null,
    teamSize: 1,
    portfolioItemCount: 0,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  };
}

describe("SearchDirectoryUseCase", () => {
  let professionals: FakeSearchableProfessionalDiscoveryRepository;
  let companies: FakeSearchableCompanyDiscoveryRepository;
  let categories: FakeServiceCategoryRepository;
  let useCase: SearchDirectoryUseCase;

  beforeEach(() => {
    professionals = new FakeSearchableProfessionalDiscoveryRepository();
    companies = new FakeSearchableCompanyDiscoveryRepository();
    categories = new FakeServiceCategoryRepository();
    categories.seed({ id: ELECTRICIAN_ID, name: "Electrician", slug: "electrician" });
    categories.seed({ id: PLUMBER_ID, name: "Plumber", slug: "plumber" });
    useCase = new SearchDirectoryUseCase(professionals, companies, categories, () => FIXED_NOW);
  });

  function input(overrides: Record<string, unknown> = {}) {
    return {
      verifiedOnly: false,
      sortBy: "RELEVANCE" as const,
      page: 1,
      pageSize: 20,
      ...overrides,
    };
  }

  it("returns both professionals and companies in one unified result", async () => {
    professionals.seed(professional({ id: "pro-1", categoryIds: [ELECTRICIAN_ID] }));
    companies.seed(company({ id: "company-1", categoryIds: [ELECTRICIAN_ID] }));

    const result = await useCase.execute(input());

    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.kind).sort()).toEqual(["COMPANY", "PROFESSIONAL"]);
  });

  it("excludes suspended professionals and non-active companies", async () => {
    professionals.seed(professional({ id: "pro-suspended", status: "SUSPENDED", categoryIds: [ELECTRICIAN_ID] }));
    companies.seed(company({ id: "company-pending", status: "PENDING", categoryIds: [ELECTRICIAN_ID] }));
    professionals.seed(professional({ id: "pro-active", categoryIds: [ELECTRICIAN_ID] }));

    const result = await useCase.execute(input());

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe("pro-active");
  });

  it("filters by category — a candidate not offering the category is excluded", async () => {
    professionals.seed(professional({ id: "electrician", categoryIds: [ELECTRICIAN_ID] }));
    professionals.seed(professional({ id: "plumber", categoryIds: [PLUMBER_ID] }));

    const result = await useCase.execute(input({ categoryId: ELECTRICIAN_ID }));

    expect(result.items.map((i) => i.id)).toEqual(["electrician"]);
  });

  it("rejects an unknown/inactive category id", async () => {
    await expect(useCase.execute(input({ categoryId: "99999999-9999-9999-9999-999999999999" }))).rejects.toThrow();
  });

  it("filters by verifiedOnly", async () => {
    professionals.seed(professional({ id: "verified", verificationStatus: "VERIFIED" }));
    professionals.seed(professional({ id: "unverified", verificationStatus: "UNVERIFIED" }));

    const result = await useCase.execute(input({ verifiedOnly: true }));

    expect(result.items.map((i) => i.id)).toEqual(["verified"]);
  });

  it("filters by minRating and minReviewCount", async () => {
    professionals.seed(professional({ id: "high", averageRating: 4.8, reviewCount: 50 }));
    professionals.seed(professional({ id: "low", averageRating: 3.0, reviewCount: 2 }));

    const result = await useCase.execute(input({ minRating: 4, minReviewCount: 10 }));

    expect(result.items.map((i) => i.id)).toEqual(["high"]);
  });

  it("filters by city", async () => {
    professionals.seed(professional({ id: "gandia-pro", city: "Gandia" }));
    professionals.seed(professional({ id: "madrid-pro", city: "Madrid" }));

    const result = await useCase.execute(input({ city: "Gandia" }));

    expect(result.items.map((i) => i.id)).toEqual(["gandia-pro"]);
  });

  it("ranks a verified, highly-rated, well-reviewed professional above an unverified low-rated one", async () => {
    professionals.seed(
      professional({
        id: "star",
        verificationStatus: "VERIFIED",
        averageRating: 4.9,
        reviewCount: 200,
        portfolioItemCount: 5,
        city: "Gandia",
      }),
    );
    professionals.seed(professional({ id: "weak", verificationStatus: "UNVERIFIED", averageRating: 3.0, reviewCount: 1 }));

    const result = await useCase.execute(input({ city: "Gandia" }));

    // "weak" doesn't match city, so only "star" should appear when filtering
    // by city — re-run without the city filter to compare ranking directly.
    const both = await useCase.execute(input());
    expect(both.items[0]?.id).toBe("star");
    expect(result.items.map((i) => i.id)).toEqual(["star"]);
  });

  it("exposes customer-safe ranking reasons but never a raw numeric score field", async () => {
    professionals.seed(
      professional({ id: "star", verificationStatus: "VERIFIED", averageRating: 4.9, reviewCount: 120 }),
    );

    const result = await useCase.execute(input());
    const item = result.items[0];
    if (!item) throw new Error("expected at least one result");

    expect(item.rankingReasons.length).toBeGreaterThan(0);
    expect(item.rankingReasons).toContain("Verified professional");
    expect(Object.keys(item)).not.toContain("score");
    expect(Object.keys(item)).not.toContain("total");
  });

  it("never exposes verification-case internals (rejection reasons, reviewer ids, documents)", async () => {
    professionals.seed(professional({ id: "pro-1" }));
    const result = await useCase.execute(input());
    const first = result.items[0];
    if (!first) throw new Error("expected at least one result");
    const keys = Object.keys(first);
    for (const forbidden of ["rejectionReason", "resubmissionReason", "reviewedByUserId", "documents", "fileUrl"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("sorts by RATING when requested", async () => {
    professionals.seed(professional({ id: "low", averageRating: 3.5, reviewCount: 10 }));
    professionals.seed(professional({ id: "high", averageRating: 4.9, reviewCount: 10 }));

    const result = await useCase.execute(input({ sortBy: "RATING" }));

    expect(result.items.map((i) => i.id)).toEqual(["high", "low"]);
  });

  it("sorts by REVIEWS when requested", async () => {
    professionals.seed(professional({ id: "fewer", reviewCount: 5, averageRating: 4 }));
    professionals.seed(professional({ id: "more", reviewCount: 500, averageRating: 4 }));

    const result = await useCase.execute(input({ sortBy: "REVIEWS" }));

    expect(result.items.map((i) => i.id)).toEqual(["more", "fewer"]);
  });

  it("sorts by NEWEST when requested", async () => {
    professionals.seed(professional({ id: "older", createdAt: new Date("2020-01-01T00:00:00.000Z") }));
    professionals.seed(professional({ id: "newer", createdAt: new Date("2026-07-01T00:00:00.000Z") }));

    const result = await useCase.execute(input({ sortBy: "NEWEST" }));

    expect(result.items.map((i) => i.id)).toEqual(["newer", "older"]);
  });

  it("sorts by VERIFIED when requested", async () => {
    professionals.seed(professional({ id: "unverified", verificationStatus: "UNVERIFIED" }));
    professionals.seed(professional({ id: "verified", verificationStatus: "VERIFIED" }));

    const result = await useCase.execute(input({ sortBy: "VERIFIED" }));

    expect(result.items.map((i) => i.id)).toEqual(["verified", "unverified"]);
  });

  it("paginates results with offset pagination", async () => {
    for (let i = 0; i < 25; i += 1) {
      professionals.seed(professional({ id: `pro-${String(i).padStart(2, "0")}` }));
    }

    const page1 = await useCase.execute(input({ page: 1, pageSize: 10 }));
    const page2 = await useCase.execute(input({ page: 2, pageSize: 10 }));
    const page3 = await useCase.execute(input({ page: 3, pageSize: 10 }));

    expect(page1.total).toBe(25);
    expect(page1.items).toHaveLength(10);
    expect(page2.items).toHaveLength(10);
    expect(page3.items).toHaveLength(5);

    const allIds = [...page1.items, ...page2.items, ...page3.items].map((i) => i.id);
    expect(new Set(allIds).size).toBe(25); // no duplicates/gaps across pages
  });

  it("returns an empty result set (not an error) when nothing matches", async () => {
    const result = await useCase.execute(input({ city: "Nowhere" }));
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("runs correctly with every optional filter omitted", async () => {
    professionals.seed(professional({ id: "pro-1" }));
    const result = await useCase.execute({ verifiedOnly: false, sortBy: "RELEVANCE", page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
  });

  it("produces a fully deterministic order across repeated runs", async () => {
    for (let i = 0; i < 8; i += 1) {
      professionals.seed(
        professional({ id: `pro-${i}`, averageRating: 4, reviewCount: 10, createdAt: new Date("2025-01-01") }),
      );
    }

    const first = await useCase.execute(input());
    const second = await useCase.execute(input());

    expect(second.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
  });

  it("breaks ties between equal-score candidates deterministically by id, independent of insertion order", async () => {
    // Two professionals with identical every signal — only id differs.
    companies.seed(company({ id: "b-company" }));
    professionals.seed(professional({ id: "a-pro" }));

    const seededThisWay = await useCase.execute(input());

    // Re-seed in reverse insertion order in fresh repositories.
    const professionals2 = new FakeSearchableProfessionalDiscoveryRepository();
    const companies2 = new FakeSearchableCompanyDiscoveryRepository();
    professionals2.seed(professional({ id: "a-pro" }));
    companies2.seed(company({ id: "b-company" }));
    const useCase2 = new SearchDirectoryUseCase(professionals2, companies2, categories, () => FIXED_NOW);
    const seededOtherWay = await useCase2.execute(input());

    expect(seededThisWay.items.map((i) => i.id)).toEqual(seededOtherWay.items.map((i) => i.id));
  });
});
