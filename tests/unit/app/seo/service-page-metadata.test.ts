import { afterEach, describe, expect, it, vi } from "vitest";

import { setTestLocale } from "../../../test-utils/intl";

/**
 * Module 118 — AI-Readable Service & Location Knowledge:
 * `generateMetadata` for `/servicios/[slug]`. Same `vi.doMock` +
 * dynamic `import()` technique as `professional-profile-metadata.test.ts`.
 */
afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

describe("service page generateMetadata", () => {
  it("builds title/description/canonical for a verified, curated service", async () => {
    setTestLocale("es");
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        serviceCategory: {
          findFirst: vi.fn().mockResolvedValue({
            id: "cat-1",
            slug: "fontaneria",
            name: "Fontanería",
            description: "Reparación de fugas, grifos, tuberías e instalaciones de agua.",
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/servicios/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "fontaneria" }) });

    expect(metadata.title).toBe("Fontanería — MaestroYa");
    expect(metadata.description).toBe("Reparación de fugas, grifos, tuberías e instalaciones de agua.");
    expect(metadata.alternates).toMatchObject({ canonical: "/servicios/fontaneria" });
    expect(metadata.openGraph).toMatchObject({ url: "/servicios/fontaneria" });
  });

  it("returns empty metadata for a slug the database has no ACTIVE top-level category for", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        serviceCategory: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn() },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/servicios/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "fontaneria" }) });

    expect(metadata).toEqual({});
  });

  it("returns empty metadata for a real, active category with no curated content (never invents copy)", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        serviceCategory: {
          findFirst: vi.fn().mockResolvedValue({
            id: "cat-2",
            slug: "limpieza",
            name: "Limpieza",
            description: null,
          }),
          findMany: vi.fn(),
        },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/servicios/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "limpieza" }) });

    expect(metadata).toEqual({});
  });

  it("localizes title/description (Module 120) but keeps the single canonical URL", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        serviceCategory: {
          findFirst: vi.fn().mockResolvedValue({
            id: "cat-1",
            slug: "fontaneria",
            name: "Fontanería",
            description: "Reparación de fugas, grifos, tuberías e instalaciones de agua.",
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/servicios/[slug]/page");

    const en = await generateMetadata({ params: Promise.resolve({ slug: "fontaneria" }) });
    expect(en.title).toBe("Plumbing — MaestroYa");
    expect(en.openGraph).toMatchObject({ locale: "en_US", url: "/servicios/fontaneria" });

    setTestLocale("ru");
    const ru = await generateMetadata({ params: Promise.resolve({ slug: "fontaneria" }) });
    expect(ru.title).toBe("Сантехника — MaestroYa");
    expect(ru.alternates).toEqual({ canonical: "/servicios/fontaneria" });
    expect(ru.openGraph).toMatchObject({ locale: "ru_RU" });
  });
});
