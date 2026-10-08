import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

/**
 * Guards the production security headers (Module 25 — Production
 * Infrastructure) against accidental regressions — e.g. someone loosening
 * the CSP or dropping X-Frame-Options while fixing an unrelated build
 * issue.
 */
describe("next.config.ts security headers", () => {
  it("applies security headers to all routes", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");

    const headerNames = rules[0]!.headers.map((h) => h.key);
    expect(headerNames).toEqual(
      expect.arrayContaining([
        "X-Frame-Options",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Content-Security-Policy",
      ]),
    );
  });

  it("scopes the CSP to self plus this app's actual external dependencies", async () => {
    const rules = await nextConfig.headers!();
    const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;

    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/res\.cloudinary\.com/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  it("allows exactly Stripe's documented origins for the Module 144 Payment Element — no wildcard, no extra eval", async () => {
    const rules = await nextConfig.headers!();
    const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

    expect(directive("script-src")).toContain("https://js.stripe.com");
    expect(directive("frame-src").split(" ").sort()).toEqual(["frame-src", "https://hooks.stripe.com", "https://js.stripe.com"]);
    expect(directive("connect-src")).toContain("https://api.stripe.com");
    expect(csp).not.toMatch(/\*\.stripe\.com/);
    expect(directive("default-src")).toBe("default-src 'self'");
  });

  it("uses standalone output for Docker readiness", () => {
    expect(nextConfig.output).toBe("standalone");
  });
});
