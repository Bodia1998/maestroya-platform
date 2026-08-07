import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { VALID_BASE_ENV } from "../../unit/core/infrastructure/config/env-fixture";
import { REQUEST_ID_HEADER } from "@/infrastructure/observability/request-id";

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
  });

  it("Module 44: an unreachable Redis does not affect readiness status or HTTP code", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    process.env.REDIS_URL = "redis://127.0.0.1:1"; // reserved, never-listening port
    vi.resetModules();

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.cache).toBe("error");

    delete process.env.REDIS_URL;
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

    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.cachingLayer.status).toBe("bypassed");
    expect(body.checks.cachingLayer.bypass).toBe(true);

    delete process.env.CACHE_BYPASS_ENABLED;
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
