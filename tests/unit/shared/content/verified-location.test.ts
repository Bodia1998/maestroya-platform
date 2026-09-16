import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

describe("findVerifiedCity", () => {
  it("matches by city/province/country name, case-insensitively", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "city-1",
      name: "Gandia",
      province: { name: "Valencia", country: { code: "ES" } },
    });
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { city: { findFirst } },
    }));

    const { findVerifiedCity } = await import("@/shared/content/verified-location");
    const result = await findVerifiedCity("gandia", "valencia", "ES");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: { equals: "gandia", mode: "insensitive" },
          province: { name: { equals: "valencia", mode: "insensitive" }, country: { code: "ES" } },
        },
      }),
    );
    expect(result).toEqual({ id: "city-1", cityName: "Gandia", provinceName: "Valencia", countryCode: "ES" });
  });

  it("returns null when no matching city exists", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { city: { findFirst: vi.fn().mockResolvedValue(null) } },
    }));

    const { findVerifiedCity } = await import("@/shared/content/verified-location");
    expect(await findVerifiedCity("Playa de Gandia", "Valencia", "ES")).toBeNull();
  });
});
