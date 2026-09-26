import { beforeAll, describe, expect, it } from "vitest";
import type { Metadata } from "next";

import { generateMetadata } from "@/app/layout";
import { setTestLocale } from "../../../test-utils/intl";

let metadata: Metadata;
beforeAll(async () => {
  metadata = await generateMetadata();
});

/**
 * Module 43 — SEO Infrastructure: asserts the root layout's site-wide
 * `Metadata` export — `metadata` is a plain object computed at module
 * load (no DB/session access; that only happens inside the `RootLayout`
 * component function itself), so importing this module for its export is
 * safe and side-effect-free the same way importing any other constants
 * module is.
 */
describe("root layout metadata", () => {
  it("sets metadataBase from SITE_URL", () => {
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(metadata.metadataBase?.toString()).toBe("http://localhost:3000/");
  });

  it("defines a title template so child pages can set just their own title", () => {
    expect(metadata.title).toMatchObject({
      default: expect.stringContaining("MaestroYa"),
      template: "%s | MaestroYa",
    });
  });

  it("sets a permissive default robots policy", () => {
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("declares Open Graph and Twitter card defaults", () => {
    expect(metadata.openGraph).toMatchObject({ type: "website", siteName: "MaestroYa" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("points icons and manifest at the generated routes", () => {
    expect(metadata.icons).toMatchObject({ icon: "/icon", apple: "/apple-icon" });
    expect(metadata.manifest).toBe("/manifest.webmanifest");
  });

  it("follows the active locale for text and og:locale, without hreflang alternates", async () => {
    setTestLocale("ru");
    const ru = await generateMetadata();
    expect(ru.title).toMatchObject({ default: expect.stringMatching(/MaestroYa.*[а-яё]/i) });
    expect(ru.openGraph).toMatchObject({ locale: "ru_RU" });
    expect(ru.alternates).toEqual({ canonical: "/" });

    setTestLocale("es");
    const es = await generateMetadata();
    expect(es.title).toMatchObject({ default: "MaestroYa — Encuentra profesionales de confianza para tu hogar" });
    expect(es.openGraph).toMatchObject({ locale: "es_ES" });
  });
});
