import { describe, expect, it } from "vitest";

import { loadEnvWith, VALID_BASE_ENV } from "./env-fixture";

describe("infrastructure/config/env", () => {
  it("parses a valid development configuration", async () => {
    const { env, isProduction, isDevelopment } = await loadEnvWith({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info"); // default applied
    expect(isProduction).toBe(false);
    expect(isDevelopment).toBe(true);
  });

  it("fails fast when a required variable is missing", async () => {
    await expect(loadEnvWith({ DATABASE_URL: undefined })).rejects.toThrow(
      /Invalid environment variables/,
    );
  });

  it("fails fast when NEXT_PUBLIC_APP_URL is not a valid URL", async () => {
    await expect(loadEnvWith({ NEXT_PUBLIC_APP_URL: "not-a-url" })).rejects.toThrow(
      /Invalid environment variables/,
    );
  });

  it("rejects an invalid LOG_LEVEL value", async () => {
    await expect(loadEnvWith({ LOG_LEVEL: "verbose" })).rejects.toThrow(
      /Invalid environment variables/,
    );
  });

  it("defaults AUTH_TRUST_HOST to true and coerces it to a boolean", async () => {
    const { env } = await loadEnvWith({});
    expect(env.AUTH_TRUST_HOST).toBe(true);

    const { env: withFalse } = await loadEnvWith({ AUTH_TRUST_HOST: "false" });
    expect(withFalse.AUTH_TRUST_HOST).toBe(false);
  });

  it("does not require production-strength secrets outside production", async () => {
    const { env } = await loadEnvWith({ NODE_ENV: "test", AUTH_SECRET: "short" });
    expect(env.NODE_ENV).toBe("test");
  });

  describe("production hardening", () => {
    it("rejects an AUTH_SECRET shorter than 32 characters", async () => {
      await expect(
        loadEnvWith({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "https://maestroya.example.com",
          AUTH_URL: "https://maestroya.example.com",
          AUTH_SECRET: "too-short",
        }),
      ).rejects.toThrow(/Invalid environment variables/);
    });

    it("rejects a non-HTTPS NEXT_PUBLIC_APP_URL", async () => {
      await expect(
        loadEnvWith({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "http://maestroya.example.com",
          AUTH_URL: "https://maestroya.example.com",
          AUTH_SECRET: "a".repeat(32),
        }),
      ).rejects.toThrow(/Invalid environment variables/);
    });

    it("rejects Stripe test-mode keys", async () => {
      await expect(
        loadEnvWith({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "https://maestroya.example.com",
          AUTH_URL: "https://maestroya.example.com",
          AUTH_SECRET: "a".repeat(32),
          STRIPE_SECRET_KEY: "sk_test_shouldnotbeallowed",
        }),
      ).rejects.toThrow(/Invalid environment variables/);
    });

    it("accepts a properly hardened production configuration", async () => {
      const { env, isProduction } = await loadEnvWith({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://maestroya.example.com",
        AUTH_URL: "https://maestroya.example.com",
        AUTH_SECRET: "a".repeat(32),
        STRIPE_SECRET_KEY: "sk_live_realkey",
        STRIPE_PUBLISHABLE_KEY: "pk_live_realkey",
      });
      expect(isProduction).toBe(true);
      expect(env.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it("skips strict production checks during the Next.js build phase", async () => {
      // `next build` forces NODE_ENV=production even for CI/placeholder
      // builds — NEXT_PHASE distinguishes "building" from "actually
      // serving production traffic". See env.ts's own comment.
      const { env } = await loadEnvWith({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
        AUTH_SECRET: "short",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        AUTH_URL: "http://localhost:3000",
      });
      expect(env.NODE_ENV).toBe("production");
    });
  });

  it("never includes secret values in the base fixture accidentally left empty", () => {
    // Sanity check on the fixture itself, not env.ts — guards against a
    // future edit accidentally introducing an empty required field that
    // would make every other test in this suite pass for the wrong reason.
    for (const [key, value] of Object.entries(VALID_BASE_ENV)) {
      expect(value, `${key} should not be empty in the fixture`).not.toBe("");
    }
  });
});
