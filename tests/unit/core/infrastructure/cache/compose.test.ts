import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * Same `vi.resetModules()` + dynamic-import pattern as Module 45's own
 * `infrastructure/jobs/compose.test.ts` — `getCacheManager()` memoizes a
 * module-level singleton, so each case needs a fresh module graph to
 * observe different env (`CACHE_BYPASS_ENABLED`, `REDIS_URL`).
 */
async function loadCompose(envOverrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();
  return import("@/infrastructure/cache/compose");
}

describe("infrastructure/cache/compose", () => {
  afterEach(() => {
    delete (process.env as Record<string, string | undefined>).CACHE_BYPASS_ENABLED;
    delete (process.env as Record<string, string | undefined>).CACHE_KEY_PREFIX;
    delete (process.env as Record<string, string | undefined>).REDIS_URL;
  });

  it("getCacheManager() returns the same instance every call", async () => {
    const { getCacheManager } = await loadCompose();
    expect(getCacheManager()).toBe(getCacheManager());
  });

  it("getCacheNamespace() returns namespaces backed by the shared manager", async () => {
    const { getCacheNamespace } = await loadCompose();
    const ns = getCacheNamespace("professionals");
    await ns.set(["k"], "v", 5000);
    await expect(getCacheNamespace("professionals").get(["k"])).resolves.toBe("v");
  });

  it("getCacheHealth() reports driver 'memory' when REDIS_URL is unset", async () => {
    const { getCacheHealth } = await loadCompose();
    expect(getCacheHealth().driver).toBe("memory");
    expect(getCacheHealth().status).toBe("ok");
    expect(getCacheHealth().bypass).toBe(false);
  });

  it("getCacheHealth() reports status 'bypassed' and bypass true when CACHE_BYPASS_ENABLED=true", async () => {
    const { getCacheHealth } = await loadCompose({ CACHE_BYPASS_ENABLED: "true" });
    expect(getCacheHealth().status).toBe("bypassed");
    expect(getCacheHealth().bypass).toBe(true);
  });

  it("getCacheHealth() includes live statistics from the shared manager", async () => {
    const { getCacheManager, getCacheHealth } = await loadCompose();
    await getCacheManager().get("ns", ["missing"]);
    expect(getCacheHealth().stats.misses).toBe(1);
  });

  it("CACHE_BYPASS_ENABLED='true' makes every read a forced miss end-to-end", async () => {
    const { getCacheNamespace } = await loadCompose({ CACHE_BYPASS_ENABLED: "true" });
    const ns = getCacheNamespace("ns");
    await ns.set(["k"], "v", 5000);
    await expect(ns.get(["k"])).resolves.toBeNull();
  });
});
