import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 43 — SEO Infrastructure: mocks `@/infrastructure/database/prisma/client`
 * the same way `prisma-language-repository.test.ts` does, so this runs
 * with no real database and asserts both the query shape (ACTIVE +
 * non-deleted only, id/updatedAt-only projection — the perf requirement)
 * and the resulting sitemap entries.
 *
 * Module 118 — AI-Readable Service & Location Knowledge: `sitemap()` now
 * also verifies the curated service/location content catalogs against
 * live `serviceCategory`/`city` reads before listing their URLs — every
 * mock below includes those two calls so the existing professional/
 * company assertions keep passing unchanged, plus new cases for the
 * service/location/service+location entries themselves.
 */

const GANDIA_CITY_ROW = {
  id: "city-gandia",
  name: "Gandia",
  province: { name: "Valencia", country: { code: "ES" } },
};

function mockPrisma(overrides: {
  professionals?: unknown[];
  companies?: unknown[];
  categories?: unknown[];
  city?: unknown | null;
  country?: unknown | null;
}) {
  const professionalFindMany = vi.fn().mockResolvedValue(overrides.professionals ?? []);
  const companyFindMany = vi.fn().mockResolvedValue(overrides.companies ?? []);
  const categoryFindMany = vi.fn().mockResolvedValue(overrides.categories ?? []);
  const cityFindFirst = vi.fn().mockResolvedValue(overrides.city ?? null);
  // Module 118 (continuation) — Spain-wide geographic coverage: defaults
  // to a verified "ES" row so every pre-existing test (written before
  // `/ubicaciones/espana` existed) keeps passing unchanged unless it
  // explicitly opts out with `country: null`.
  const countryFindFirst = vi
    .fn()
    .mockResolvedValue(overrides.country === undefined ? { id: "country-es", code: "ES", name: "Spain" } : overrides.country);

  vi.doMock("@/infrastructure/database/prisma/client", () => ({
    prisma: {
      professionalProfile: { findMany: professionalFindMany },
      companyProfile: { findMany: companyFindMany },
      serviceCategory: { findMany: categoryFindMany },
      city: { findFirst: cityFindFirst },
      country: { findFirst: countryFindFirst },
    },
  }));

  return { professionalFindMany, companyFindMany, categoryFindMany, cityFindFirst, countryFindFirst };
}

afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

describe("sitemap()", () => {
  it("includes the static marketing pages plus every ACTIVE professional/company", async () => {
    mockPrisma({
      professionals: [{ id: "prof-1", updatedAt: new Date("2026-01-01T00:00:00Z") }],
      companies: [{ id: "company-1", updatedAt: new Date("2026-02-01T00:00:00Z") }],
    });

    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/professionals"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/search"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/professionals/prof-1"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/companies/company-1"))).toBe(true);
    // No dedicated `/companies` index page exists yet — see sitemap.ts's
    // own doc comment.
    expect(urls.some((url) => /\/companies$/.test(url))).toBe(false);
  });

  it("only queries ACTIVE, non-deleted professionals and companies, id/updatedAt-only", async () => {
    const { professionalFindMany, companyFindMany } = mockPrisma({});

    const { default: sitemap } = await import("@/app/sitemap");
    await sitemap();

    expect(professionalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true, updatedAt: true },
      }),
    );
    expect(companyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true, updatedAt: true },
      }),
    );
  });

  it("always includes the /servicios and /ubicaciones index pages", async () => {
    mockPrisma({});

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/servicios"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/ubicaciones"))).toBe(true);
  });

  it("lists a service page only for a category verified live as ACTIVE/top-level", async () => {
    mockPrisma({
      categories: [{ id: "cat-1", slug: "fontaneria", name: "Fontanería", description: null }],
    });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/servicios/fontaneria"))).toBe(true);
    // A category with no curated content in `shared/content/services.ts`
    // must never get a page — see that file's own doc comment.
    expect(urls.some((url) => url.endsWith("/servicios/unknown-category"))).toBe(false);
  });

  it("never lists a service page for a category the database does not return", async () => {
    mockPrisma({ categories: [] });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => /\/servicios\/[a-z-]+$/.test(url))).toBe(false);
  });

  it("lists the Gandia location page only when the City table verifies it", async () => {
    mockPrisma({ city: GANDIA_CITY_ROW });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/ubicaciones/gandia"))).toBe(true);
  });

  it("never lists the Gandia location page when the City table has no matching row", async () => {
    mockPrisma({ city: null });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/ubicaciones/gandia"))).toBe(false);
  });

  it("lists a service+location page only when both the category and the city verify live", async () => {
    mockPrisma({
      categories: [{ id: "cat-1", slug: "fontaneria", name: "Fontanería", description: null }],
      city: GANDIA_CITY_ROW,
    });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/servicios/fontaneria/gandia"))).toBe(true);
  });

  it("never lists a service+location page when the city does not verify, even if the service does", async () => {
    mockPrisma({
      categories: [{ id: "cat-1", slug: "fontaneria", name: "Fontanería", description: null }],
      city: null,
    });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.includes("/servicios/fontaneria/"))).toBe(false);
  });
});

describe("sitemap() — Spain-wide coverage (Module 118 continuation)", () => {
  it("lists /ubicaciones/espana when the seeded ES Country row verifies", async () => {
    mockPrisma({ country: { id: "country-es", code: "ES", name: "Spain" } });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/ubicaciones/espana"))).toBe(true);
  });

  it("never lists /ubicaciones/espana when the Country table has no ES row", async () => {
    mockPrisma({ country: null });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/ubicaciones/espana"))).toBe(false);
  });

  it("keeps listing Gandia's location page independently of the national coverage page", async () => {
    mockPrisma({ city: GANDIA_CITY_ROW, country: { id: "country-es", code: "ES", name: "Spain" } });

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/ubicaciones/gandia"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/ubicaciones/espana"))).toBe(true);
  });
});
