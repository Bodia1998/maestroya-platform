import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { VALID_BASE_ENV } from "../../unit/core/infrastructure/config/env-fixture";
import { REQUEST_ID_HEADER } from "@/infrastructure/observability/request-id";

/**
 * Test-timing note (investigated while diagnosing Module 78's `npm test`
 * run — see MODULE_78_HEALTH_TEST_TIMEOUT_AUDIT.md for the full audit;
 * Module 78 itself does not touch health/observability/circuit-breaker
 * code and is not the cause of the underlying timing margin):
 *
 * Nearly every test below does a real `vi.resetModules()` followed by a
 * fresh dynamic `import()` of the actual health/observability route
 * composition root — deliberate end-to-end coverage of the real wiring,
 * not a mock. Re-transforming and re-evaluating that module graph, plus
 * (for the diagnostics/full-readiness-aggregation tests specifically)
 * dependency checks bounded by `CIRCUIT_BREAKER_TIMEOUT_MS` (defaults to
 * 5000ms — see `@/infrastructure/config/env.ts`), already measured 4.0-4.5s
 * on an otherwise idle machine — leaving almost no margin against Vitest's
 * own default 5000ms `testTimeout` once this file runs alongside the rest
 * of a large, CPU-contended parallel suite. That race (two independent
 * ~5s budgets, near-zero margin) is the actual root cause of the
 * intermittent "Test timed out in 5000ms" failures, not a functional
 * defect in these routes. Scoped to *this file only* — never
 * `vitest.config.ts`'s global `testTimeout` — so every other test file's
 * fast-failure timeout stays exactly as tight as it was before.
 */
vi.setConfig({ testTimeout: 20000 });


/**
 * Integration-style tests for the liveness/readiness split (Module 25 —
 * Production Infrastructure). `/api/health` (liveness) must never touch
 * the database; `/api/health/ready` (readiness) must, and must report
 * 503 when it's unreachable rather than throwing an unhandled error.
 */

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/health", { headers });
}

describe("GET /api/health (liveness)", () => {
  it("returns 200 without querying the database", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: {
        $queryRaw: vi.fn().mockRejectedValue(new Error("should never be called")),
      },
    }));

    const { GET } = await import("@/app/api/health/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();

    vi.doUnmock("@/infrastructure/database/prisma/client");
    vi.resetModules();
  });

  it("preserves a valid incoming X-Request-ID", async () => {
    const { GET } = await import("@/app/api/health/route");
    const incoming = "550e8400-e29b-41d4-a716-446655440000";
    const response = await GET(makeRequest({ [REQUEST_ID_HEADER]: incoming }));
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(incoming);
  });
});

describe("GET /api/health/ready (readiness)", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(VALID_BASE_ENV)) process.env[key] = value;
  });

  afterEach(() => {
    vi.doUnmock("@/infrastructure/database/prisma/client");
    vi.resetModules();
  });

  it("returns 200 when the database is reachable", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    // Module 44 — Redis Infrastructure: reported for visibility, never
    // required — REDIS_URL is unset by VALID_BASE_ENV in this test suite.
    expect(body.checks.cache).toBe("not_configured");
    // Module 49 — SMS Notifications: reported for visibility, never
    // required — SMS_PROVIDER defaults to "mock", always healthy.
    expect(body.checks.smsProvider.status).toBe("healthy");
    expect(body.checks.smsProvider.provider).toBe("mock");
  });

  it("Module 44: an unreachable Redis does not affect readiness status or HTTP code", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    process.env.REDIS_URL = "redis://127.0.0.1:1"; // reserved, never-listening port
    vi.resetModules();

    // try/finally, not a plain statement after the assertions: if any
    // assertion below throws (or this test times out), REDIS_URL must
    // still be cleared, otherwise it silently leaks into every later
    // test/file sharing this worker — turning one legitimate failure
    // here into cascading, unrelated failures elsewhere (each paying the
    // same real-connection latency this test intentionally exercises).
    try {
      const { GET } = await import("@/app/api/health/ready/route");
      const response = await GET(makeRequest());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(body.checks.database).toBe("ok");
      expect(body.checks.cache).toBe("error");
    } finally {
      delete process.env.REDIS_URL;
    }
  });

  it("Module 46: reports caching-layer health without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    // REDIS_URL/CACHE_BYPASS_ENABLED are unset by VALID_BASE_ENV, so the
    // caching layer runs on the in-memory provider with bypass off.
    expect(body.checks.cachingLayer).toEqual(
      expect.objectContaining({ status: "ok", driver: "memory", bypass: false }),
    );
    expect(body.checks.cachingLayer.stats).toEqual(
      expect.objectContaining({ hits: 0, misses: 0, hitRatio: 0 }),
    );
  });

  it("Module 46: caching-layer status is 'bypassed' when CACHE_BYPASS_ENABLED=true, without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    process.env.CACHE_BYPASS_ENABLED = "true";
    vi.resetModules();

    // Same try/finally reasoning as the "Module 44" test above — cleanup
    // must run even if an assertion fails, or CACHE_BYPASS_ENABLED leaks
    // into every later test/file on this worker.
    try {
      const { GET } = await import("@/app/api/health/ready/route");
      const response = await GET(makeRequest());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(body.checks.cachingLayer.status).toBe("bypassed");
      expect(body.checks.cachingLayer.bypass).toBe(true);
    } finally {
      delete process.env.CACHE_BYPASS_ENABLED;
    }
  });

  it("Module 45: reports background-job queue status without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    // EVENT_QUEUE_ENABLED is unset by VALID_BASE_ENV, so no queue was ever
    // registered — "disabled" is the healthy, expected default.
    expect(body.checks.queue).toEqual({ status: "disabled", driver: "none", queues: {} });
  });

  it("Module 47: reports search-engine health without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    // SEARCH_PROVIDER is unset, so the search engine runs on the fully
    // functional in-memory provider — "ok", not "not_configured"/"disabled".
    expect(body.checks.searchEngine).toEqual(
      expect.objectContaining({ status: "ok", provider: "memory", reachable: true, indexingEnabled: true }),
    );
  });

  it("Module 47: search-engine status is 'disabled' when SEARCH_INDEXING_ENABLED=false, without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    process.env.SEARCH_INDEXING_ENABLED = "false";
    vi.resetModules();

    try {
      const { GET } = await import("@/app/api/health/ready/route");
      const response = await GET(makeRequest());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(body.checks.searchEngine.status).toBe("disabled");
    } finally {
      delete process.env.SEARCH_INDEXING_ENABLED;
    }
  });

  it("Module 50: reports analytics-dashboard health without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    // The refresh pipeline is enabled by default and no snapshot has been
    // computed yet in this fresh module instance — "ok" (not "disabled"),
    // with no snapshot present yet.
    expect(body.checks.analytics).toEqual(
      expect.objectContaining({ status: "ok", refreshEnabled: true, hasSnapshot: false }),
    );
  });

  it("Module 50: analytics status is 'disabled' when ANALYTICS_REFRESH_ENABLED=false, without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    process.env.ANALYTICS_REFRESH_ENABLED = "false";
    vi.resetModules();

    try {
      const { GET } = await import("@/app/api/health/ready/route");
      const response = await GET(makeRequest());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(body.checks.analytics.status).toBe("disabled");
    } finally {
      delete process.env.ANALYTICS_REFRESH_ENABLED;
    }
  });

  it("Module 51: reports tracing health as 'disabled' by default, without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    // TRACING_ENABLED is unset by VALID_BASE_ENV — "disabled" is the
    // healthy, deliberate default (see tracing-health.ts).
    expect(body.checks.tracing).toEqual({
      status: "disabled",
      enabled: false,
      provider: "none",
      exporter: "none",
      serviceName: "none",
    });
  });

  it("Module 51: tracing status is 'ok' once TRACING_ENABLED=true and the SDK has started, without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.doMock("@/infrastructure/tracing/otel-sdk", () => ({
      startOtelSdk: vi.fn(() => ({ shutdown: vi.fn().mockResolvedValue(undefined), exporting: true })),
    }));
    process.env.TRACING_ENABLED = "true";
    vi.resetModules();

    try {
      const { startTracing } = await import("@/infrastructure/tracing/compose");
      await startTracing();

      const { GET } = await import("@/app/api/health/ready/route");
      const response = await GET(makeRequest());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.checks.tracing.status).toBe("ok");
      expect(body.checks.tracing.provider).toBe("opentelemetry");
      expect(body.checks.tracing.exporter).toBe("console");
    } finally {
      vi.doUnmock("@/infrastructure/tracing/otel-sdk");
      delete process.env.TRACING_ENABLED;
    }
  });

  it("Module 53: reports configuration health as 'ok' for the valid baseline env, without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checks.configuration).toEqual(
      expect.objectContaining({ status: "ok", requiredSecretsConfigured: true, issues: [] }),
    );
  });

  it("Module 53: configuration status is 'degraded' when SMS_PROVIDER=twilio is selected without credentials, without affecting readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    process.env.SMS_PROVIDER = "twilio";
    vi.resetModules();

    try {
      const { GET } = await import("@/app/api/health/ready/route");
      const response = await GET(makeRequest());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(body.checks.configuration.status).toBe("degraded");
      expect(body.checks.configuration.issues.length).toBeGreaterThan(0);
    } finally {
      delete process.env.SMS_PROVIDER;
    }
  });

  it("returns 503 when the database is unreachable", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockRejectedValue(new Error("connection refused")) },
    }));
    vi.resetModules();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.checks.database).toBe("error");
    errorSpy.mockRestore();
  });
});
