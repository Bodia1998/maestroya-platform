import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

const GANDIA_ROW = {
  id: "city-1",
  name: "Gandia",
  province: { name: "Valencia", country: { code: "ES" } },
};

const FONTANERIA_ROW = {
  id: "cat-1",
  slug: "fontaneria",
  name: "Fontanería",
  description: "Reparación de fugas, grifos, tuberías e instalaciones de agua.",
};

describe("service+location page generateMetadata", () => {
  it("builds metadata for a justified, verified pair (fontaneria + gandia)", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        serviceCategory: { findFirst: vi.fn().mockResolvedValue(FONTANERIA_ROW), findMany: vi.fn() },
        city: { findFirst: vi.fn().mockResolvedValue(GANDIA_ROW) },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/servicios/[slug]/[location]/page");
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "fontaneria", location: "gandia" }),
    });

    expect(metadata.title).toBe("Fontanería en Gandia — MaestroYa");
    expect(metadata.alternates).toMatchObject({ canonical: "/servicios/fontaneria/gandia" });
  });

  it("returns empty metadata for a pair never reviewed/justified, even if both sides would verify", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        serviceCategory: { findFirst: vi.fn().mockResolvedValue(FONTANERIA_ROW), findMany: vi.fn() },
        city: { findFirst: vi.fn().mockResolvedValue(GANDIA_ROW) },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/servicios/[slug]/[location]/page");
    // "fontaneria" + "madrid" is not in JUSTIFIED_SERVICE_LOCATION_PAIRS —
    // must 404 (empty metadata) purely on that basis, before any DB call
    // even matters.
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "fontaneria", location: "madrid" }),
    });

    expect(metadata).toEqual({});
  });

  it("returns empty metadata when the service verifies but the city does not", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        serviceCategory: { findFirst: vi.fn().mockResolvedValue(FONTANERIA_ROW), findMany: vi.fn() },
        city: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/servicios/[slug]/[location]/page");
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "fontaneria", location: "gandia" }),
    });

    expect(metadata).toEqual({});
  });

  it("returns empty metadata when the city verifies but the service does not", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        serviceCategory: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn() },
        city: { findFirst: vi.fn().mockResolvedValue(GANDIA_ROW) },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/servicios/[slug]/[location]/page");
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "fontaneria", location: "gandia" }),
    });

    expect(metadata).toEqual({});
  });
});
