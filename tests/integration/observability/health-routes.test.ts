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
