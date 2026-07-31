import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for PrismaLanguageRepository's ordering contract —
 * part of the same Language.sortOrder schema regression covered by
 * tests/unit/prisma/language-schema-contract.test.ts and
 * tests/unit/prisma/seed-languages.test.ts. Mocks
 * `@/infrastructure/database/prisma/client` the same way
 * tests/integration/observability/health-routes.test.ts does, so this runs
 * as a true unit test with no real database — it only asserts the shape of
 * the query PrismaLanguageRepository issues.
 */

afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

describe("PrismaLanguageRepository.listActive", () => {
  it("orders active languages by sortOrder ascending, then name ascending", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { language: { findMany } },
    }));

    const { PrismaLanguageRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-language-repository"
    );

    await new PrismaLanguageRepository().listActive();

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, name: true, nativeName: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  });

  it("does not order alphabetically alone (name must not be the only orderBy key)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { language: { findMany } },
    }));

    const { PrismaLanguageRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-language-repository"
    );

    await new PrismaLanguageRepository().listActive();

    const call = findMany.mock.calls[0]?.[0];
    expect(Array.isArray(call.orderBy)).toBe(true);
    expect(call.orderBy).not.toEqual([{ name: "asc" }]);
    expect(call.orderBy[0]).toEqual({ sortOrder: "asc" });
  });
});

describe("PrismaLanguageRepository.findActiveByIds", () => {
  it("returns an empty array without querying when given no ids", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { language: { findMany } },
    }));

    const { PrismaLanguageRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-language-repository"
    );

    const result = await new PrismaLanguageRepository().findActiveByIds([]);

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the given ids and isActive: true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { language: { findMany } },
    }));

    const { PrismaLanguageRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-language-repository"
    );

    await new PrismaLanguageRepository().findActiveByIds(["lang-1", "lang-2"]);

    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["lang-1", "lang-2"] }, isActive: true },
      select: { id: true, name: true, nativeName: true },
    });
  });
});
