import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 87 — Test Hardening & Production Verification: HTTP-level
 * security-boundary test for `GET /api/cron/expire-workflows`. Prior to
 * this module, this route (Module 28's daily expiration sweep entry
 * point) had no test file at all — see MODULE_87_IMPLEMENTATION_REPORT.md
 * and the deliberate twin `reconciliation-run-route.test.ts` in this same
 * directory, which shares this exact auth pattern.
 */

const mockExecute = vi.fn();
const mockReportException = vi.fn();

const envMock: { CRON_SECRET: string | undefined } = { CRON_SECRET: undefined };

vi.mock("@/infrastructure/config/env", () => ({ env: envMock }));

vi.mock("@/application/use-cases/workflow-expiration/compose", () => ({
  makeRunWorkflowExpirationsUseCase: () => ({ execute: mockExecute }),
}));

vi.mock("@/infrastructure/observability/error-reporter-factory", () => ({
  createErrorReporter: () => ({ reportException: mockReportException }),
}));

const { GET } = await import("../../../../../src/app/api/cron/expire-workflows/route");

function makeRequest(authHeader: string | null): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/cron/expire-workflows", { method: "GET", headers });
}

describe("GET /api/cron/expire-workflows", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockReportException.mockReset();
    envMock.CRON_SECRET = undefined;
  });

  it("fails closed with 503 when CRON_SECRET is not configured, and never invokes the expiration sweep", async () => {
    envMock.CRON_SECRET = undefined;

    const response = await GET(makeRequest("Bearer anything"));

    expect(response.status).toBe(503);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("fails closed with 401 when no Authorization header is present, even though CRON_SECRET is configured", async () => {
    envMock.CRON_SECRET = "correct-secret";

    const response = await GET(makeRequest(null));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("fails closed with 401 on a mismatched bearer token", async () => {
    envMock.CRON_SECRET = "correct-secret";

    const response = await GET(makeRequest("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("invokes the expiration sweep and returns 200 on a valid bearer token", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue({ totalExpired: 4 });

    const response = await GET(makeRequest("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.result.totalExpired).toBe(4);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("reports and returns 500 without leaking internals when the use case itself throws unexpectedly", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockRejectedValue(new Error("simulated database outage"));

    const response = await GET(makeRequest("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toContain("simulated database outage");
    expect(mockReportException).toHaveBeenCalledTimes(1);
  });
});
