import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 95 — API Security Hardening: this route (Module 94's GDPR
 * Cloudinary purge retry cron) previously had no dedicated HTTP-level
 * test — see the deliberate twin `expire-workflows-route.test.ts` in this
 * same directory, which this file mirrors exactly, plus a case pinning
 * the timing-safe comparison fix (a same-length wrong secret must still
 * be rejected, not accidentally accepted by a naive length-only check).
 */

const mockExecute = vi.fn();
const mockReportException = vi.fn();
const mockReportMessage = vi.fn();

const envMock: {
  CRON_SECRET: string | undefined;
  GDPR_CLOUDINARY_PURGE_RETRY_BATCH_SIZE: number;
} = { CRON_SECRET: undefined, GDPR_CLOUDINARY_PURGE_RETRY_BATCH_SIZE: 25 };

vi.mock("@/infrastructure/config/env", () => ({ env: envMock }));

vi.mock("@/application/use-cases/gdpr/compose", () => ({
  makeRetryPendingCloudinaryPurgesUseCase: () => ({ execute: mockExecute }),
}));

vi.mock("@/infrastructure/observability/error-reporter-factory", () => ({
  createErrorReporter: () => ({ reportException: mockReportException, reportMessage: mockReportMessage }),
}));

const { GET } = await import("../../../../../src/app/api/cron/gdpr-cloudinary-purge/route");

function makeRequest(authHeader: string | null): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/cron/gdpr-cloudinary-purge", { method: "GET", headers });
}

describe("GET /api/cron/gdpr-cloudinary-purge", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockReportException.mockReset();
    mockReportMessage.mockReset();
    envMock.CRON_SECRET = undefined;
  });

  it("fails closed with 503 when CRON_SECRET is not configured, and never invokes the retry sweep", async () => {
    envMock.CRON_SECRET = undefined;

    const response = await GET(makeRequest("Bearer anything"));

    expect(response.status).toBe(503);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("fails closed with 401 when no Authorization header is present", async () => {
    envMock.CRON_SECRET = "correct-secret";

    const response = await GET(makeRequest(null));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("fails closed with 401 on a mismatched bearer token of the same length", async () => {
    envMock.CRON_SECRET = "correct-secretx";

    const response = await GET(makeRequest("Bearer correct-secretY"));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("invokes the retry sweep and returns 200 on a valid bearer token", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue({ outcome: "ok", claimed: 3, succeeded: 3, retried: 0, deadLettered: 0 });

    const response = await GET(makeRequest("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(envMock.GDPR_CLOUDINARY_PURGE_RETRY_BATCH_SIZE);
  });

  it("reports a message (but still 200s) when documents are dead-lettered", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue({ outcome: "ok", claimed: 5, succeeded: 2, retried: 1, deadLettered: 2 });

    const response = await GET(makeRequest("Bearer correct-secret"));

    expect(response.status).toBe(200);
    expect(mockReportMessage).toHaveBeenCalledTimes(1);
  });

  it("reports and returns 500 without leaking internals when the use case itself throws unexpectedly", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockRejectedValue(new Error("simulated storage outage"));

    const response = await GET(makeRequest("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toContain("simulated storage outage");
    expect(mockReportException).toHaveBeenCalledTimes(1);
  });
});
