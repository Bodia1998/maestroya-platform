import { afterEach, describe, expect, it, vi } from "vitest";

import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";
import { VALID_BASE_ENV } from "../config/env-fixture";

const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://maestroya.example.com",
  AUTH_URL: "https://maestroya.example.com",
  AUTH_SECRET: "a".repeat(32),
  STRIPE_SECRET_KEY: "sk_live_realkey",
  STRIPE_PUBLISHABLE_KEY: "pk_live_realkey",
  SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
};

/**
 * Module 44 — Redis Infrastructure.
 *
 * Confirms the exact swap `InMemoryRateLimitRepository`'s own doc
 * comment (Module 24) and `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md`
 * (§14, §29) both anticipated: `RateLimitRepository` resolves to a
 * Redis-backed implementation once `REDIS_URL` is configured, with the
 * exact same interface — no caller (`AntiAbuseService`,
 * `application/use-cases/security/compose.ts`) needs to change.
 */
async function loadFactory(redisUrl: string | undefined) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  if (redisUrl === undefined) delete mutableEnv.REDIS_URL;
  else mutableEnv.REDIS_URL = redisUrl;

  vi.resetModules();
  return Promise.all([
    import("@/infrastructure/security/rate-limit-repository-factory"),
    import("@/infrastructure/security/in-memory-rate-limit-repository"),
    import("@/infrastructure/security/redis-rate-limit-repository"),
  ]);
}

describe("infrastructure/security/rate-limit-repository-factory", () => {
  let server: FakeRedisServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    delete (process.env as Record<string, string | undefined>).REDIS_URL;
  });

  it("returns InMemoryRateLimitRepository when REDIS_URL is unset", async () => {
    const [{ createRateLimitRepository }, { InMemoryRateLimitRepository }] = await loadFactory(undefined);
    expect(createRateLimitRepository()).toBeInstanceOf(InMemoryRateLimitRepository);
  });

  it("returns RedisRateLimitRepository when REDIS_URL is configured", async () => {
    server = await startFakeRedisServer();
    const [{ createRateLimitRepository }, , { RedisRateLimitRepository }] = await loadFactory(server.url);
    expect(createRateLimitRepository()).toBeInstanceOf(RedisRateLimitRepository);
  });

  it("memoizes a single instance per process", async () => {
    const [{ createRateLimitRepository }] = await loadFactory(undefined);
    expect(createRateLimitRepository()).toBe(createRateLimitRepository());
  });

  /**
   * Module 82 — Admin RBAC & Production Auth Hardening (H10): production
   * must never silently select `InMemoryRateLimitRepository`. The primary
   * guarantee lives in env.ts (a production process with no `REDIS_URL`
   * fails to even start — see env.test.ts's own REDIS_URL coverage); these
   * two tests prove the second half of that guarantee end-to-end through
   * this factory specifically, plus the factory's own defensive check for
   * the case that first guarantee is ever weakened.
   */
  describe("production", () => {
    it("selects RedisRateLimitRepository in production when REDIS_URL is configured", async () => {
      server = await startFakeRedisServer();
      const mutableEnv = process.env as Record<string, string | undefined>;
      for (const [key, value] of Object.entries(PRODUCTION_ENV)) mutableEnv[key] = value;
      mutableEnv.REDIS_URL = server.url;

      vi.resetModules();
      const [{ createRateLimitRepository }, { RedisRateLimitRepository }] = await Promise.all([
        import("@/infrastructure/security/rate-limit-repository-factory"),
        import("@/infrastructure/security/redis-rate-limit-repository"),
      ]);
      expect(createRateLimitRepository()).toBeInstanceOf(RedisRateLimitRepository);

      delete mutableEnv.NODE_ENV;
      for (const key of Object.keys(PRODUCTION_ENV)) delete mutableEnv[key];
    });

    it("refuses to fall back to InMemoryRateLimitRepository in production even if a Redis client somehow could not be constructed", async () => {
      // Simulates the defensive branch in createRateLimitRepository() —
      // `getRedisClient()` returning null while `isProduction` is true is
      // meant to be unreachable in practice (env.ts's own superRefine
      // already refuses to start production without a valid REDIS_URL),
      // but this proves the factory itself fails loudly rather than
      // silently degrading if that invariant is ever broken upstream.
      vi.resetModules();
      vi.doMock("@/infrastructure/cache/redis-client-factory", () => ({
        getRedisClient: () => null,
      }));
      vi.doMock("@/infrastructure/config/env", () => ({
        isProduction: true,
      }));

      const { createRateLimitRepository } = await import(
        "@/infrastructure/security/rate-limit-repository-factory"
      );
      expect(() => createRateLimitRepository()).toThrow(/REDIS_URL must be configured/);

      vi.doUnmock("@/infrastructure/cache/redis-client-factory");
      vi.doUnmock("@/infrastructure/config/env");
    });
  });
});
