import { afterEach, describe, expect, it, vi } from "vitest";

/** Module 43 — SEO Infrastructure: see
 *  `professional-profile-metadata.test.ts`'s own doc comment — same
 *  mocking technique, the company-side mirror. */

afterEach(() => {
  vi.doUnmock("@/application/use-cases/discovery/compose");
  vi.resetModules();
});

const PROFILE = {
  id: "company-1",
  slug: "fontaneros-madrid",
  displayName: "Fontaneros Madrid SL",
  legalName: "Fontaneros Madrid SL",
  description: "Empresa de fontanería en Madrid" as string | null,
  logoUrl: "https://res.cloudinary.com/x/logo.png" as string | null,
  websiteUrl: null,
  isVerified: true,
  averageRating: 4.5,
  reviewCount: 8,
  categoryIds: [],
  city: "Madrid" as string | null,
  province: "Madrid" as string | null,
  teamSize: 3,
};

describe("company profile generateMetadata", () => {
  it("builds title/description/canonical/OG from the public profile", async () => {
    const getById = vi.fn().mockResolvedValue(PROFILE);
    vi.doMock("@/application/use-cases/discovery/compose", () => ({
      makeGetCompanyPublicProfileUseCase: () => ({ getById }),
    }));

    const { generateMetadata } = await import("@/app/(marketing)/companies/[id]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "company-1" }) });

    expect(metadata.title).toBe("Fontaneros Madrid SL");
    expect(metadata.description).toBe("Empresa de fontanería en Madrid");
    expect(metadata.alternates).toMatchObject({ canonical: "/companies/company-1" });
    expect(metadata.openGraph?.images).toEqual([{ url: PROFILE.logoUrl }]);
  });

  it("falls back to a generated description when the company has none", async () => {
    const getById = vi.fn().mockResolvedValue({ ...PROFILE, description: null });
    vi.doMock("@/application/use-cases/discovery/compose", () => ({
      makeGetCompanyPublicProfileUseCase: () => ({ getById }),
    }));

    const { generateMetadata } = await import("@/app/(marketing)/companies/[id]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "company-1" }) });

    expect(metadata.description).toContain("Madrid");
  });

  it("returns empty metadata for an unknown company", async () => {
    const { NotFoundError } = await import("@/domain/errors/domain-error");
    const getById = vi.fn().mockRejectedValue(new NotFoundError("Company", "missing"));
    vi.doMock("@/application/use-cases/discovery/compose", () => ({
      makeGetCompanyPublicProfileUseCase: () => ({ getById }),
    }));

    const { generateMetadata } = await import("@/app/(marketing)/companies/[id]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "missing" }) });

    expect(metadata).toEqual({});
  });
});
