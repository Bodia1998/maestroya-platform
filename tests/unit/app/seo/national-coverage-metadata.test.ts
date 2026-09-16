import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 118 (continuation) — Spain-wide geographic coverage:
 * `generateMetadata` for the static `/ubicaciones/espana` page. Same
 * `vi.doMock` technique as every other page-metadata test in this suite.
 */
afterEach(() => {
  vi.doUnmock("@/infrastructure/database/prisma/client");
  vi.resetModules();
});

describe("national coverage page generateMetadata", () => {
  it("builds title/description/canonical when the ES Country row verifies", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        country: { findFirst: vi.fn().mockResolvedValue({ id: "country-1", code: "ES", name: "Spain" }) },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/ubicaciones/espana/page");
    const metadata = await generateMetadata();

    expect(metadata.title).toBe("MaestroYa en España — cobertura nacional");
    expect(metadata.alternates).toMatchObject({ canonical: "/ubicaciones/espana" });
    expect(metadata.openGraph).toMatchObject({ url: "/ubicaciones/espana" });
  });

  it("returns empty metadata when the Country table has no ES row", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { country: { findFirst: vi.fn().mockResolvedValue(null) } },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/ubicaciones/espana/page");
    const metadata = await generateMetadata();

    expect(metadata).toEqual({});
  });

  it("never claims a title implying availability everywhere (no 'disponible en todas partes' wording)", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        country: { findFirst: vi.fn().mockResolvedValue({ id: "country-1", code: "ES", name: "Spain" }) },
      },
    }));

    const { generateMetadata } = await import("@/app/(marketing)/ubicaciones/espana/page");
    const metadata = await generateMetadata();
    const text = `${metadata.title} ${metadata.description}`;

    expect(text).not.toMatch(/disponible en (todas?|cada) (parte|ciudad|municipio)/i);
  });
});

describe("national coverage page — structured data discipline (no LocalBusiness)", () => {
  it("the page module source never references LocalBusiness structured data", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const pagePath = path.resolve(
      process.cwd(),
      "src/app/(marketing)/ubicaciones/espana/page.tsx",
    );
    const source = await fs.readFile(pagePath, "utf-8");

    // The doc comment inside the page explains *why* LocalBusiness is
    // deliberately not used, so it legitimately contains the word — this
    // asserts the actual JSON-LD builder is never imported/called, not
    // that the string never appears anywhere.
    expect(source).not.toMatch(/buildLocalBusinessJsonLd/);
    expect(source).toContain("buildServiceJsonLd");
    expect(source).toContain("buildBreadcrumbJsonLd");
    expect(source).toContain("buildFaqJsonLd");
  });
});
