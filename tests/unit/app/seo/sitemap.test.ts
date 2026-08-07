import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 43 — SEO Infrastructure: mocks `@/infrastructure/database/prisma/client`
 * the same way `prisma-language-repository.test.ts` does, so this runs
 * with no real database and asserts both the query shape (ACTIVE +
 * non-deleted only, id/updatedAt-only projection — the perf requirement)
 * and the resulting sitemap entries.
 */

afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

describe("sitemap()", () => {
  it("includes the static marketing pages plus every ACTIVE professional/company", async () => {
    const professionalFindMany = vi.fn().mockResolvedValue([
      { id: "prof-1", updatedAt: new Date("2026-01-01T00:00:00Z") },
    ]);
    const companyFindMany = vi.fn().mockResolvedValue([
      { id: "company-1", updatedAt: new Date("2026-02-01T00:00:00Z") },
    ]);

    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        professionalProfile: { findMany: professionalFindMany },
        companyProfile: { findMany: companyFindMany },
      },
    }));

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
    const professionalFindMany = vi.fn().mockResolvedValue([]);
    const companyFindMany = vi.fn().mockResolvedValue([]);

    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        professionalProfile: { findMany: professionalFindMany },
        companyProfile: { findMany: companyFindMany },
      },
    }));

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
});
