import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 87 — Test Hardening & Production Verification: HTTP-level
 * security-boundary test for `GET /api/cron/reconciliation-run`. Prior
 * to this module, this route (Module 90's external-scheduler entry point
 * into the financial reconciliation engine) had no test file at all,
 * unlike every Stripe/Persona webhook route which has a dedicated
 * `*-route.test.ts` — see MODULE_87_IMPLEMENTATION_REPORT.md. Mirrors
 * the "import the real route, mock only its dependencies, invoke it with
 * a real NextRequest" convention `persona-route.test.ts` already
 * establishes.
 *
 * This file only proves the route's own thin-controller contract: it
 * fails closed with 503 when CRON_SECRET isn't configured, fails closed
 * with 401 on a missing/mismatched bearer token, and only then delegates
 * to the real reconciliation use case. The use case's own behavior is
 * covered separately by start-reconciliation-run.use-case.test.ts.
 */

const mockExecute = vi.fn();
const mockReportMessage = vi.fn();
const mockReportException = vi.fn();

const envMock: { CRON_SECRET: string | undefined; RECONCILIATION_SCHEDULE_SCOPE: string; RECONCILIATION_SCHEDULE_LIMIT: number } = {
  CRON_SECRET: undefined,
  RECONCILIATION_SCHEDULE_SCOPE: "FULL",
  RECONCILIATION_SCHEDULE_LIMIT: 500,
};

vi.mock("@/infrastructure/config/env", () => ({ env: envMock }));

vi.mock("@/application/use-cases/reconciliation/compose", () => ({
  makeStartReconciliationRunUseCase: () => ({ execute: mockExecute }),
}));

vi.mock("@/infrastructure/observability/error-reporter-factory", () => ({
  createErrorReporter: () => ({ reportMessage: mockReportMessage, reportException: mockReportException }),
}));

const { GET } = await import("../../../../../src/app/api/cron/reconciliation-run/route");

function makeRequest(authHeader: string | null): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/cron/reconciliation-run", { method: "GET", headers });
}

function makeRunSummary(overrides: Partial<{ status: string; errorMessage: string | null }> = {}) {
  return {
    run: {
      id: "run-1",
      status: overrides.status ?? "COMPLETED",
      recordsInspected: 3,
      errorMessage: overrides.errorMessage ?? null,
    },
    discrepanciesCreated: 1,
    discrepanciesReconfirmed: 0,
  };
}

describe("GET /api/cron/reconciliation-run", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockReportMessage.mockReset();
    mockReportException.mockReset();
    envMock.CRON_SECRET = undefined;
  });

  it("fails closed with 503 when CRON_SECRET is not configured, and never invokes the reconciliation engine", async () => {
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

  it("rejects a bare secret without the required 'Bearer ' scheme", async () => {
    envMock.CRON_SECRET = "correct-secret";

    const response = await GET(makeRequest("correct-secret"));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("invokes the reconciliation engine and returns 200 on a valid bearer token", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue(makeRunSummary({ status: "COMPLETED" }));

    const response = await GET(makeRequest("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.result.runId).toBe("run-1");
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith({ scope: "FULL", limit: 500 }, null);
  });

  it("surfaces an engine-level FAILED run as a 500 and reports it, without throwing", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue(makeRunSummary({ status: "FAILED", errorMessage: "simulated provider outage" }));

    const response = await GET(makeRequest("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.status).toBe("error");
    expect(mockReportMessage).toHaveBeenCalledTimes(1);
  });

  it("reports and returns 500 without leaking internals when the use case itself throws unexpectedly", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockRejectedValue(new Error("simulated unexpected crash"));

    const response = await GET(makeRequest("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toContain("simulated unexpected crash");
    expect(mockReportException).toHaveBeenCalledTimes(1);
  });
});
