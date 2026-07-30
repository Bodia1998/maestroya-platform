import { describe, expect, it } from "vitest";

import { resolvePostLoginDestination } from "@/shared/utils/resolve-post-login-destination";

/**
 * Root-cause regression coverage: the login form previously always sent a
 * just-signed-in user to `callbackUrl` (defaulting to `"/dashboard"`),
 * leaving the professional-specific destination entirely to a second
 * request through middleware.ts. These cases pin down the actual
 * decision now made immediately after sign-in — see
 * resolve-post-login-destination.ts's own doc comment for the full
 * reasoning and the four required scenarios from the bug report.
 */
describe("resolvePostLoginDestination", () => {
  it("sends an ordinary customer (no PROVIDER role, no signupIntent) to the default destination", () => {
    const destination = resolvePostLoginDestination(
      { roles: ["CUSTOMER"], signupIntent: null },
      { explicitCallbackUrl: null, defaultDestination: "/dashboard" },
    );

    expect(destination).toBe("/dashboard");
  });

  it("sends a PROFESSIONAL-intent account without the PROVIDER role to onboarding", () => {
    const destination = resolvePostLoginDestination(
      { roles: ["CUSTOMER"], signupIntent: "PROFESSIONAL" },
      { explicitCallbackUrl: null, defaultDestination: "/dashboard" },
    );

    expect(destination).toBe("/dashboard/professional/onboarding");
  });

  it("sends an account that already has the PROVIDER role straight to the Professional Dashboard", () => {
    const destination = resolvePostLoginDestination(
      { roles: ["CUSTOMER", "PROVIDER"], signupIntent: "PROFESSIONAL" },
      { explicitCallbackUrl: null, defaultDestination: "/dashboard" },
    );

    expect(destination).toBe("/dashboard/professional");
  });

  it("prefers the PROVIDER role over a lingering PROFESSIONAL signupIntent (PROVIDER is the source of truth)", () => {
    // signupIntent is only ever cleared once onboarding completes, but the
    // PROVIDER role check is deliberately evaluated first regardless —
    // see middleware.ts's identical ordering for the same reasoning.
    const destination = resolvePostLoginDestination(
      { roles: ["PROVIDER"], signupIntent: "PROFESSIONAL" },
      { explicitCallbackUrl: null, defaultDestination: "/dashboard" },
    );

    expect(destination).toBe("/dashboard/professional");
  });

  it("always honors an explicit callbackUrl, regardless of role or signupIntent (existing role-gated-redirect behavior)", () => {
    const destination = resolvePostLoginDestination(
      { roles: ["ADMIN"], signupIntent: null },
      { explicitCallbackUrl: "/admin", defaultDestination: "/dashboard" },
    );

    expect(destination).toBe("/admin");
  });

  it("honors an explicit callbackUrl even for a PROFESSIONAL-intent account without PROVIDER (e.g. bounced back from a protected page mid-onboarding)", () => {
    const destination = resolvePostLoginDestination(
      { roles: ["CUSTOMER"], signupIntent: "PROFESSIONAL" },
      { explicitCallbackUrl: "/dashboard/messages", defaultDestination: "/dashboard" },
    );

    expect(destination).toBe("/dashboard/messages");
  });

  it("treats an empty-string signupIntent-less roles array the same as a plain customer", () => {
    const destination = resolvePostLoginDestination(
      { roles: [], signupIntent: null },
      { explicitCallbackUrl: null, defaultDestination: "/dashboard" },
    );

    expect(destination).toBe("/dashboard");
  });
});
