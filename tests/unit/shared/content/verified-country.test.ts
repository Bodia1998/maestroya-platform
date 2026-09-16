import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

describe("findVerifiedCountry", () => {
  it("queries Country by code and returns the row", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "country-1", code: "ES", name: "Spain" });
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { country: { findFirst } },
    }));

    const { findVerifiedCountry } = await import("@/shared/content/verified-country");
    const result = await findVerifiedCountry("ES");

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "ES" } }));
    expect(result).toEqual({ id: "country-1", code: "ES", name: "Spain" });
  });

  it("returns null when no matching country exists", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { country: { findFirst: vi.fn().mockResolvedValue(null) } },
    }));

    const { findVerifiedCountry } = await import("@/shared/content/verified-country");
    expect(await findVerifiedCountry("FR")).toBeNull();
  });
});
