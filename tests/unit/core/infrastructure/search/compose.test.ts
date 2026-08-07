import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * `infrastructure/search/compose.ts` constructs Prisma-backed discovery
 * repositories at module scope (needed for the projector/rebuild use
 * cases), the same way every other real composition root in this codebase
 * eventually touches Prisma. None of the assertions below ever issue a
 * query — everything here exercises in-process singleton wiring — so the
 * real client is mocked out entirely, the same way
 * `tests/integration/observability/health-routes.test.ts` already mocks it
 * for its readiness-route tests. This keeps the suite from depending on a
 * real (or even connectable) database, and from depending on the native
 * query-engine binary matching whatever OS/arch happens to run the tests.
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
  return import("@/infrastructure/search/compose");
}

describe("infrastructure/search/compose", () => {
  afterEach(() => {
    for (const key of ["SEARCH_INDEXING_ENABLED", "SEARCH_PROVIDER"]) {
      delete (process.env as Record<string, string | undefined>)[key];
    }
  });

  it("getSearchProvider()/getSearchObserver() return the same instance every call", async () => {
    const { getSearchProvider, getSearchObserver } = await loadCompose();
    expect(getSearchProvider()).toBe(getSearchProvider());
    expect(getSearchObserver()).toBe(getSearchObserver());
  });

  it("getSearchReadModelUseCase() returns a singleton wired to the shared provider", async () => {
    const { getSearchReadModelUseCase } = await loadCompose();
    expect(getSearchReadModelUseCase()).toBe(getSearchReadModelUseCase());
  });

  it("indexing enabled by default, but the worker/queue are built lazily — not at registration time", async () => {
    // Registration happens at module load (imported by loadCompose()); the
    // queue/worker must not exist yet, so that merely importing this file
    // (e.g. during `next build` analysis, or by any other compose.ts that
    // transitively imports it) never spins up a queue or worker as a
    // side effect. See getSearchIndexQueue()'s own doc comment.
    const { __testing } = await loadCompose();
    expect(__testing.worker).toBeNull();
  });

  it("getSearchIndexQueue() lazily builds the worker on first use and memoizes it thereafter", async () => {
    const { getSearchIndexQueue, __testing } = await loadCompose();
    expect(__testing.worker).toBeNull();

    const first = getSearchIndexQueue();
    expect(__testing.worker).not.toBeNull();

    const workerAfterFirstCall = __testing.worker;
    const second = getSearchIndexQueue();
    expect(second).toBe(first);
    expect(__testing.worker).toBe(workerAfterFirstCall);
  });

  it("registerSearchIndexSubscribers() is idempotent — calling it again is a harmless no-op", async () => {
    const { registerSearchIndexSubscribers, getSearchIndexQueue, __testing } = await loadCompose();

    expect(() => registerSearchIndexSubscribers()).not.toThrow();

    // The subscribed-guard means a second registration never re-enters the
    // subscription block; the queue/worker are still built lazily and only
    // once, on first actual use.
    const worker = getSearchIndexQueue();
    expect(worker).toBe(getSearchIndexQueue());
    expect(__testing.worker).not.toBeNull();
  });

  it("SEARCH_INDEXING_ENABLED=false skips subscriber/worker setup entirely", async () => {
    const { __testing } = await loadCompose({ SEARCH_INDEXING_ENABLED: "false" });
    expect(__testing.worker).toBeNull();
  });

  it("getSearchEngineHealth() reports 'disabled' when indexing is off and the provider was never built", async () => {
    const { getSearchEngineHealth } = await loadCompose({ SEARCH_INDEXING_ENABLED: "false" });
    const health = await getSearchEngineHealth();
    expect(health.status).toBe("disabled");
  });

  it("getSearchEngineHealth() reports 'ok' with the in-memory provider when indexing is enabled", async () => {
    const { getSearchEngineHealth } = await loadCompose();
    const health = await getSearchEngineHealth();
    expect(health.status).toBe("ok");
    expect(health.provider).toBe("memory");
    expect(health.indexingEnabled).toBe(true);
  });

  it("__testing.reset() drops this module's own singletons (read model, worker) so the next call rebuilds them", async () => {
    const { getSearchReadModelUseCase, getSearchIndexQueue, __testing } = await loadCompose();
    const readModelBefore = getSearchReadModelUseCase();
    getSearchIndexQueue();
    expect(__testing.worker).not.toBeNull();

    __testing.reset();

    expect(__testing.worker).toBeNull();
    expect(getSearchReadModelUseCase()).not.toBe(readModelBefore);
  });

  it("__testing.reset() does not force a re-decision of the process-wide provider (owned by search-provider-factory.ts's own memoization)", async () => {
    const { getSearchProvider, __testing } = await loadCompose();
    const before = getSearchProvider();
    __testing.reset();
    // The provider itself is still the same object — only
    // `search-provider-factory.ts`'s own `__testing.reset()` (a different
    // module) forces a fresh provider decision, exactly like
    // `cache-provider-factory.ts`'s relationship to `cache/compose.ts`.
    expect(getSearchProvider()).toBe(before);
  });
});
