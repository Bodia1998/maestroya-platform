import { describe, expect, it } from "vitest";

import { ALLOWED_PATHS, DISALLOWED_PATHS } from "@/shared/seo/robots-rules";

/**
 * Module 43 — SEO Infrastructure: keeps `DISALLOWED_PATHS` honest against
 * `middleware.ts`'s own auth-gated prefixes — every one of those prefixes
 * must also be crawl-disallowed, or a search engine could index an
 * authenticated-only page's redirect-to-login shell.
 */
const AUTH_GATED_PREFIXES = [
  "/dashboard",
  "/requests",
  "/appointments",
  "/jobs",
  "/messages",
  "/disputes",
  "/support-tickets",
  "/profile",
  "/admin",
];

describe("DISALLOWED_PATHS", () => {
  it("disallows every auth-gated route prefix from middleware.ts", () => {
    for (const prefix of AUTH_GATED_PREFIXES) {
      expect(DISALLOWED_PATHS).toContain(prefix);
    }
  });

  it("disallows the internal API surface", () => {
    expect(DISALLOWED_PATHS).toContain("/api");
  });

  it("disallows the auth flow (password reset / email verification tokens)", () => {
    expect(DISALLOWED_PATHS).toContain("/auth");
  });

  it("never disallows a publicly indexable path", () => {
    for (const publicPath of ALLOWED_PATHS) {
      expect(DISALLOWED_PATHS).not.toContain(publicPath);
    }
  });
});

describe("ALLOWED_PATHS", () => {
  it("includes the homepage and every public discovery surface", () => {
    expect(ALLOWED_PATHS).toContain("/");
    expect(ALLOWED_PATHS).toContain("/professionals");
    expect(ALLOWED_PATHS).toContain("/search");
  });
});
