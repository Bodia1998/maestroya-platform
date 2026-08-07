import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 43 — SEO Infrastructure: `shared/seo/site.ts` reads
 * `NEXT_PUBLIC_APP_URL` from `process.env` directly (not through
 * `@/infrastructure/config/env`, deliberately — see that file's own doc
 * comment on why), so these tests exercise it via dynamic re-import with
 * `vi.resetModules()` between cases, the same technique
 * `prisma-language-repository.test.ts` uses for its own module-level
 * mocking.
 */

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  }
  vi.resetModules();
});

describe("SITE_URL", () => {
  it("strips a trailing slash from NEXT_PUBLIC_APP_URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://maestroya.es/";
    vi.resetModules();
    const { SITE_URL } = await import("@/shared/seo/site");
    expect(SITE_URL).toBe("https://maestroya.es");
  });

  it("falls back to localhost when NEXT_PUBLIC_APP_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.resetModules();
    const { SITE_URL } = await import("@/shared/seo/site");
    expect(SITE_URL).toBe("http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  it("joins a site-relative path onto SITE_URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://maestroya.es";
    vi.resetModules();
    const { absoluteUrl } = await import("@/shared/seo/site");
    expect(absoluteUrl("/professionals/123")).toBe("https://maestroya.es/professionals/123");
  });

  it("tolerates a path with no leading slash", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://maestroya.es";
    vi.resetModules();
    const { absoluteUrl } = await import("@/shared/seo/site");
    expect(absoluteUrl("search")).toBe("https://maestroya.es/search");
  });
});

describe("toOgLocale", () => {
  it("maps every supported interface locale to a region-qualified OG locale", async () => {
    const { toOgLocale } = await import("@/shared/seo/site");
    expect(toOgLocale("es")).toBe("es_ES");
    expect(toOgLocale("en")).toBe("en_US");
    expect(toOgLocale("de")).toBe("de_DE");
  });

  it("falls back to Spanish for an unrecognized locale", async () => {
    const { toOgLocale } = await import("@/shared/seo/site");
    expect(toOgLocale("xx")).toBe("es_ES");
  });
});
