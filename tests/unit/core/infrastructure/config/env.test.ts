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

  describe("GEOCODING_PROVIDER (Module 27 — Spain Location Services)", () => {
    it("defaults to STATIC when unset — the app must never accidentally call a real geocoding API", async () => {
      const { env } = await loadEnvWith({ GEOCODING_PROVIDER: undefined });
      expect(env.GEOCODING_PROVIDER).toBe("STATIC");
    });

    it("falls back to STATIC (never fails startup) for an invalid/unknown value", async () => {
      const { env } = await loadEnvWith({ GEOCODING_PROVIDER: "NOT_A_REAL_PROVIDER" });
      expect(env.GEOCODING_PROVIDER).toBe("STATIC");
    });

    it("falls back to STATIC for an empty string", async () => {
      const { env } = await loadEnvWith({ GEOCODING_PROVIDER: "" });
      expect(env.GEOCODING_PROVIDER).toBe("STATIC");
    });

    it("accepts every valid provider value unchanged", async () => {
      for (const value of ["STATIC", "MAPBOX", "GOOGLE", "HERE", "OSM"]) {
        const { env } = await loadEnvWith({ GEOCODING_PROVIDER: value });
        expect(env.GEOCODING_PROVIDER).toBe(value);
      }
    });

    it("is case-sensitive — a lowercase value is invalid and falls back to STATIC", async () => {
      const { env } = await loadEnvWith({ GEOCODING_PROVIDER: "mapbox" });
      expect(env.GEOCODING_PROVIDER).toBe("STATIC");
    });
  });

  describe("production hardening", () => {
    // Every case below also sets SENTRY_DSN — a valid production
    // configuration requires it (Module 39, see the dedicated "Sentry
    // configuration validation" suite below); a case that isn't testing
    // that specific requirement sets it purely so the test only exercises
    // the one thing it's named for.
    const SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";

    it("rejects an AUTH_SECRET shorter than 32 characters", async () => {
      await expect(
        loadEnvWith({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "https://maestroya.example.com",
          AUTH_URL: "https://maestroya.example.com",
          AUTH_SECRET: "too-short",
          SENTRY_DSN,
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
          SENTRY_DSN,
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
          SENTRY_DSN,
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
        SENTRY_DSN,
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

  describe("Sentry configuration validation (Module 39 — Sentry + CI/CD Hardening)", () => {
    it("rejects a production configuration missing SENTRY_DSN", async () => {
      await expect(
        loadEnvWith({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "https://maestroya.example.com",
          AUTH_URL: "https://maestroya.example.com",
          AUTH_SECRET: "a".repeat(32),
          STRIPE_SECRET_KEY: "sk_live_realkey",
          STRIPE_PUBLISHABLE_KEY: "pk_live_realkey",
          SENTRY_DSN: undefined,
        }),
      ).rejects.toThrow(/Invalid environment variables/);
    });

    it("accepts a production configuration with SENTRY_DSN set", async () => {
      const { env } = await loadEnvWith({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://maestroya.example.com",
        AUTH_URL: "https://maestroya.example.com",
        AUTH_SECRET: "a".repeat(32),
        STRIPE_SECRET_KEY: "sk_live_realkey",
        STRIPE_PUBLISHABLE_KEY: "pk_live_realkey",
        SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
      });
      expect(env.SENTRY_DSN).toBe("https://examplePublicKey@o0.ingest.sentry.io/0");
    });

    it("does not require SENTRY_DSN in development", async () => {
      const { env } = await loadEnvWith({ SENTRY_DSN: undefined });
      expect(env.SENTRY_DSN).toBeUndefined();
      expect(env.NODE_ENV).toBe("development");
    });

    it("does not require SENTRY_DSN during the Next.js build phase", async () => {
      const { env } = await loadEnvWith({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
        SENTRY_DSN: undefined,
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        AUTH_URL: "http://localhost:3000",
      });
      expect(env.NODE_ENV).toBe("production");
      expect(env.SENTRY_DSN).toBeUndefined();
    });

    it("rejects a malformed SENTRY_DSN value in any environment", async () => {
      await expect(loadEnvWith({ SENTRY_DSN: "not-a-url" })).rejects.toThrow(
        /Invalid environment variables/,
      );
    });

    it("rejects a SENTRY_TRACES_SAMPLE_RATE outside 0-1", async () => {
      await expect(loadEnvWith({ SENTRY_TRACES_SAMPLE_RATE: "1.5" })).rejects.toThrow(
        /Invalid environment variables/,
      );
    });

    it("accepts a valid SENTRY_TRACES_SAMPLE_RATE", async () => {
      const { env } = await loadEnvWith({ SENTRY_TRACES_SAMPLE_RATE: "0.25" });
      expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0.25);
    });
  });

  describe("Module 45 — Background Jobs", () => {
    it("EVENT_QUEUE_ENABLED is undefined by default (SynchronousEventBus stays the default)", async () => {
      const { env } = await loadEnvWith({});
      expect(env.EVENT_QUEUE_ENABLED).toBeUndefined();
    });

    it("accepts EVENT_QUEUE_ENABLED as 'true' or 'false'", async () => {
      expect((await loadEnvWith({ EVENT_QUEUE_ENABLED: "true" })).env.EVENT_QUEUE_ENABLED).toBe("true");
      expect((await loadEnvWith({ EVENT_QUEUE_ENABLED: "false" })).env.EVENT_QUEUE_ENABLED).toBe("false");
    });

    it("rejects an EVENT_QUEUE_ENABLED value that isn't 'true'/'false'", async () => {
      await expect(loadEnvWith({ EVENT_QUEUE_ENABLED: "yes" })).rejects.toThrow(/Invalid environment variables/);
    });

    it("treats an empty-string EVENT_QUEUE_ENABLED the same as unset", async () => {
      const { env } = await loadEnvWith({ EVENT_QUEUE_ENABLED: "" });
      expect(env.EVENT_QUEUE_ENABLED).toBeUndefined();
    });

    it("QUEUE_CONCURRENCY defaults to 5", async () => {
      const { env } = await loadEnvWith({});
      expect(env.QUEUE_CONCURRENCY).toBe(5);
    });

    it("QUEUE_CONCURRENCY coerces a numeric string", async () => {
      const { env } = await loadEnvWith({ QUEUE_CONCURRENCY: "20" });
      expect(env.QUEUE_CONCURRENCY).toBe(20);
    });

    it("QUEUE_CONCURRENCY falls back to its default rather than failing startup on a malformed value", async () => {
      const { env } = await loadEnvWith({ QUEUE_CONCURRENCY: "not-a-number" });
      expect(env.QUEUE_CONCURRENCY).toBe(5);
    });

    it("QUEUE_CONCURRENCY falls back to its default when out of range", async () => {
      expect((await loadEnvWith({ QUEUE_CONCURRENCY: "0" })).env.QUEUE_CONCURRENCY).toBe(5);
      expect((await loadEnvWith({ QUEUE_CONCURRENCY: "1000" })).env.QUEUE_CONCURRENCY).toBe(5);
    });

    it("QUEUE_MAX_ATTEMPTS defaults to 3", async () => {
      const { env } = await loadEnvWith({});
      expect(env.QUEUE_MAX_ATTEMPTS).toBe(3);
    });

    it("QUEUE_MAX_ATTEMPTS coerces a numeric string and falls back on a malformed one", async () => {
      expect((await loadEnvWith({ QUEUE_MAX_ATTEMPTS: "8" })).env.QUEUE_MAX_ATTEMPTS).toBe(8);
      expect((await loadEnvWith({ QUEUE_MAX_ATTEMPTS: "nope" })).env.QUEUE_MAX_ATTEMPTS).toBe(3);
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
