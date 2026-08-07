import { afterEach, describe, expect, it, vi } from "vitest";

import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";
import { VALID_BASE_ENV } from "../config/env-fixture";

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
});
