import { describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";

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
});
