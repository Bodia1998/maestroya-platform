import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * `infrastructure/analytics/compose.ts` constructs Prisma-backed
 * repositories at module scope (needed for the dispute/support-ticket
 * statistics and, transitively, Module 47/48's own composition roots),
 * the same way `infrastructure/search/compose.ts`'s own test mocks the
 * real client out entirely — none of the assertions below ever issue a
 * query.
 */
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: {} }));

async function loadCompose(envOverrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();
  return import("@/infrastructure/analytics/compose");
}

describe("infrastructure/analytics/compose", () => {
  afterEach(() => {
    for (const key of ["ANALYTICS_REFRESH_ENABLED", "ANALYTICS_CACHE_TTL_MS"]) {
      delete (process.env as Record<string, string | undefined>)[key];
    }
  });

  it("getAnalyticsReadModelStore()/getAnalyticsObserver() return the same instance every call", async () => {
    const { getAnalyticsReadModelStore, getAnalyticsObserver } = await loadCompose();
    expect(getAnalyticsReadModelStore()).toBe(getAnalyticsReadModelStore());
    expect(getAnalyticsObserver()).toBe(getAnalyticsObserver());
  });

  it("getDashboardAnalyticsUseCase() returns a singleton", async () => {
    const { getDashboardAnalyticsUseCase } = await loadCompose();
    expect(getDashboardAnalyticsUseCase()).toBe(getDashboardAnalyticsUseCase());
  });

  it("refresh is enabled by default, but the queue/worker are built lazily — not at registration time", async () => {
    // Registration happens at module load (imported by loadCompose()); the
    // queue/worker must still be unbuilt until something actually enqueues.
    const compose = await loadCompose();
    expect(compose.__testing.worker).toBeNull();
  });

  it("getAnalyticsRefreshQueue() builds the worker on first use, memoized thereafter", async () => {
    const compose = await loadCompose();
    const queue = compose.getAnalyticsRefreshQueue();
    expect(compose.__testing.worker).not.toBeNull();
    expect(compose.getAnalyticsRefreshQueue()).toBe(queue);
  });

  it("ANALYTICS_REFRESH_ENABLED=false skips subscriber registration and health reports 'disabled'", async () => {
    const compose = await loadCompose({ ANALYTICS_REFRESH_ENABLED: "false" });
    const health = await compose.getAnalyticsHealth();
    expect(health.status).toBe("disabled");
  });

  it("getAnalyticsHealth() reports 'ok' with no snapshot yet when enabled", async () => {
    const compose = await loadCompose();
    const health = await compose.getAnalyticsHealth();
    expect(health.status).toBe("ok");
    expect(health.refreshEnabled).toBe(true);
    expect(health.hasSnapshot).toBe(false);
  });

  it("__testing.reset() drops every singleton so the next call rebuilds", async () => {
    const compose = await loadCompose();
    const first = compose.getAnalyticsReadModelStore();
    compose.__testing.reset();
    const second = compose.getAnalyticsReadModelStore();
    expect(second).not.toBe(first);
  });
});
