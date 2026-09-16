import { describe, expect, it } from "vitest";

import { GET } from "@/app/llms.txt/route";
import { SITE_URL } from "@/shared/seo/site";

/**
 * Module 117 — AI Search & Recommendation Visibility Foundation:
 * `/llms.txt` route handler tests, mirroring `robots.test.ts`'s own
 * pattern of asserting against the real (not mocked) output.
 */
describe("GET /llms.txt", () => {
  it("returns a text/plain body naming the site and its public pages", async () => {
    const response = await GET();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("MaestroYa");
    expect(body).toContain(`${SITE_URL}/`);
    expect(body).toContain(`${SITE_URL}/professionals`);
    expect(body).toContain(`${SITE_URL}/search`);
    expect(body).toContain(`${SITE_URL}/sitemap.xml`);
  });

  it("never contains unsupported claims or fabricated statistics", async () => {
    const response = await GET();
    const body = (await response.text()).toLowerCase();

    // Guardrail against exactly the kind of unsupported marketing claim
    // the module brief forbids ("best", "number one", fabricated ratings,
    // guarantees) ever creeping into this file.
    expect(body).not.toMatch(/best marketplace|number one|guaranteed|cheapest|trusted by \d/);
  });
});
