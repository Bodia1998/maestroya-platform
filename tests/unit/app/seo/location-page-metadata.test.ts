import { afterEach, describe, expect, it, vi } from "vitest";

import { setTestLocale } from "../../../test-utils/intl";

afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

const GANDIA_ROW = {
  id: "city-1",
  name: "Gandia",
  province: { name: "Valencia", country: { code: "ES" } },
};

describe("location page generateMetadata", () => {
  it("builds title/description/canonical for the verified Gandia location", async () => {
    setTestLocale("es");
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { city: { findFirst: vi.fn().mockResolvedValue(GANDIA_ROW) } },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/ubicaciones/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "gandia" }) });

    expect(metadata.title).toBe("Profesionales en Gandia — MaestroYa");
    expect(metadata.alternates).toMatchObject({ canonical: "/ubicaciones/gandia" });

    setTestLocale("ru");
    const ru = await generateMetadata({ params: Promise.resolve({ slug: "gandia" }) });
    expect(ru.title).toMatch(/Gandia/);
    expect(ru.title).toMatch(/[а-яё]/i);
    expect(ru.alternates).toMatchObject({ canonical: "/ubicaciones/gandia" });
  });

  it("returns empty metadata when the City table has no matching row", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { city: { findFirst: vi.fn().mockResolvedValue(null) } },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/ubicaciones/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "gandia" }) });

    expect(metadata).toEqual({});
  });

  it("returns empty metadata for a slug with no curated content at all", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { city: { findFirst: vi.fn() } },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/ubicaciones/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "playa-de-gandia" }) });

    expect(metadata).toEqual({});
  });
});
