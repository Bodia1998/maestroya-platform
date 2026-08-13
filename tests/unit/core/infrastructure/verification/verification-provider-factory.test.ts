import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 59 — Professional Verification (Persona).
 *
 * Mirrors `geocoding-provider-factory.test.ts`'s own `vi.doMock` pattern —
 * `createVerificationProvider()` reads `env` at module scope (memoized),
 * so each scenario mocks `@/infrastructure/config/env` and resets the
 * module graph rather than mutating `process.env` directly.
 */
async function loadFactory(envOverrides: Record<string, unknown>) {
  vi.doMock("@/infrastructure/config/env", () => ({ env: envOverrides }));
  vi.resetModules();
  return import("@/infrastructure/verification/verification-provider-factory");
}

describe("createVerificationProvider", () => {
  afterEach(() => {
    vi.doUnmock("@/infrastructure/config/env");
    vi.resetModules();
  });

  it("falls back to NullVerificationProvider (MANUAL) when VERIFICATION_PROVIDER is manual", async () => {
    const { createVerificationProvider } = await loadFactory({ VERIFICATION_PROVIDER: "manual" });
    const provider = createVerificationProvider();
    expect(provider.name).toBe("MANUAL");
  });

  it("falls back to NullVerificationProvider when persona is selected but credentials are missing", async () => {
    const { createVerificationProvider } = await loadFactory({
      VERIFICATION_PROVIDER: "persona",
      PERSONA_API_KEY: undefined,
      PERSONA_TEMPLATE_ID: undefined,
    });
    const provider = createVerificationProvider();
    expect(provider.name).toBe("MANUAL");
  });

  it("constructs PersonaVerificationProvider once persona is selected and credentials are set", async () => {
    const { createVerificationProvider } = await loadFactory({
      VERIFICATION_PROVIDER: "persona",
      PERSONA_API_KEY: "key",
      PERSONA_TEMPLATE_ID: "tmpl_1",
      PERSONA_WEBHOOK_SECRET: "whsec",
      PERSONA_API_BASE_URL: undefined,
    });
    const provider = createVerificationProvider();
    expect(provider.name).toBe("PERSONA");
  });

  it("memoizes the instance across calls until __testing.reset()", async () => {
    const { createVerificationProvider, __testing } = await loadFactory({ VERIFICATION_PROVIDER: "manual" });
    const first = createVerificationProvider();
    const second = createVerificationProvider();
    expect(first).toBe(second);

    __testing.reset();
    const third = createVerificationProvider();
    expect(third).not.toBe(first);
  });
});
