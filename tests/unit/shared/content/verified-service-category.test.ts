import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

describe("findVerifiedTopLevelServiceCategory", () => {
  it("queries for an ACTIVE, non-deleted, top-level category matching the slug", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "cat-1",
      slug: "fontaneria",
      name: "Fontanería",
      description: "desc",
    });
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { serviceCategory: { findFirst, findMany: vi.fn() } },
    }));

    const { findVerifiedTopLevelServiceCategory } = await import(
      "@/shared/content/verified-service-category"
    );
    const result = await findVerifiedTopLevelServiceCategory("fontaneria");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "fontaneria", status: "ACTIVE", deletedAt: null, parentId: null },
      }),
    );
    expect(result).toMatchObject({ slug: "fontaneria", name: "Fontanería" });
  });

  it("returns null when no matching category exists", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { serviceCategory: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn() } },
    }));

    const { findVerifiedTopLevelServiceCategory } = await import(
      "@/shared/content/verified-service-category"
    );
    expect(await findVerifiedTopLevelServiceCategory("does-not-exist")).toBeNull();
  });
});

describe("listVerifiedTopLevelServiceCategories", () => {
  it("only queries ACTIVE, non-deleted, top-level categories", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { serviceCategory: { findFirst: vi.fn(), findMany } },
    }));

    const { listVerifiedTopLevelServiceCategories } = await import(
      "@/shared/content/verified-service-category"
    );
    await listVerifiedTopLevelServiceCategories();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "ACTIVE", deletedAt: null, parentId: null } }),
    );
  });
});
