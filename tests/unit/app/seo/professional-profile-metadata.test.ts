import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 43 — SEO Infrastructure: `generateMetadata` for the public
 * professional profile page. Mocks the discovery compose module (the
 * page's only data dependency) so this runs as a true unit test — same
 * `vi.doMock` + dynamic `import()` technique
 * `prisma-language-repository.test.ts` uses for its own module mocking.
 */

afterEach(() => {
  vi.doUnmock("@/application/use-cases/discovery/compose");
  vi.resetModules();
});

const PROFILE = {
  id: "prof-1",
  displayName: "Juan Pérez",
  businessName: null as string | null,
  headline: "Fontanero certificado" as string | null,
  bio: null as string | null,
  yearsExperience: 5,
  hourlyRate: 30,
  serviceRadiusKm: 10,
  verificationStatus: "VERIFIED",
  profileImageUrl: "https://res.cloudinary.com/x/prof.jpg" as string | null,
  categoryIds: [],
  city: "Madrid" as string | null,
  province: "Madrid" as string | null,
};

describe("professional profile generateMetadata", () => {
  it("builds title/description/canonical/OG from the public profile", async () => {
    const execute = vi.fn().mockResolvedValue(PROFILE);
    vi.doMock("@/application/use-cases/discovery/compose", () => ({
      makeGetProfessionalPublicProfileUseCase: () => ({ execute }),
    }));

    const { generateMetadata } = await import("@/app/(marketing)/professionals/[id]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "prof-1" }) });

    expect(metadata.title).toBe("Juan Pérez");
    expect(metadata.description).toBe("Fontanero certificado");
    expect(metadata.alternates).toMatchObject({ canonical: "/professionals/prof-1" });
    expect(metadata.openGraph).toMatchObject({
      type: "profile",
      title: "Juan Pérez",
      url: "/professionals/prof-1",
    });
    expect(metadata.openGraph?.images).toEqual([{ url: PROFILE.profileImageUrl }]);
  });

  it("prefers businessName over displayName for the title when both exist", async () => {
    const execute = vi.fn().mockResolvedValue({ ...PROFILE, businessName: "Fontanería Pérez SL" });
    vi.doMock("@/application/use-cases/discovery/compose", () => ({
      makeGetProfessionalPublicProfileUseCase: () => ({ execute }),
    }));

    const { generateMetadata } = await import("@/app/(marketing)/professionals/[id]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "prof-1" }) });

    expect(metadata.title).toBe("Fontanería Pérez SL");
  });

  it("returns empty metadata (no fabricated title) for an unknown professional", async () => {
    const execute = vi.fn().mockRejectedValue(
      // Mirrors NotFoundError's shape closely enough for the page's own
      // `instanceof NotFoundError` check — imported directly below so the
      // mock throws the real class, not a lookalike.
      new (await import("@/domain/errors/domain-error")).NotFoundError("Professional", "missing"),
    );
    vi.doMock("@/application/use-cases/discovery/compose", () => ({
      makeGetProfessionalPublicProfileUseCase: () => ({ execute }),
    }));

    const { generateMetadata } = await import("@/app/(marketing)/professionals/[id]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "missing" }) });

    expect(metadata).toEqual({});
  });
});
