import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Module 158 — the lead privacy retention cron route: fail-closed auth, dry-run switch, counts-only responses, visible failures. */
const mockExecute = vi.fn();
const mockReportException = vi.fn();
const mockReportMessage = vi.fn();
const envMock: { CRON_SECRET: string | undefined } = { CRON_SECRET: undefined };

vi.mock("@/infrastructure/config/env", () => ({ env: envMock }));
vi.mock("@/application/use-cases/lead-privacy/compose", () => ({
  makeRunLeadPrivacyRetentionUseCase: () => ({ execute: mockExecute }),
  leadPrivacyRetentionBatchSize: () => 40,
}));
vi.mock("@/infrastructure/observability/error-reporter-factory", () => ({
  createErrorReporter: () => ({ reportException: mockReportException, reportMessage: mockReportMessage }),
}));

const { GET } = await import("../../../../../src/app/api/cron/lead-privacy-retention/route");

function makeRequest(authHeader: string | null, query = ""): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(`http://localhost:3000/api/cron/lead-privacy-retention${query}`, { method: "GET", headers });
}

const OK_RESULT = {
  outcome: "completed",
  dryRun: false,
  erasedCustomerRequests: { eligible: 2, anonymized: 2, leadsCancelled: 1 },
  terminalRequestMinimization: { eligible: 0, anonymized: 0, leadsCancelled: 0, status: "POLICY_NOT_CONFIGURED" },
  openLeadsWithoutContactSharingRecord: 4,
  policy: { contactSharingBasisConfigured: false, noticeVersionConfigured: false, retentionPeriodConfigured: false },
  failedPhases: [],
};

describe("GET /api/cron/lead-privacy-retention", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockReportException.mockReset();
    mockReportMessage.mockReset();
    envMock.CRON_SECRET = undefined;
  });

  it("fails closed with 503 when CRON_SECRET is not configured", async () => {
    const response = await GET(makeRequest("Bearer anything"));
    expect(response.status).toBe(503);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("fails closed with 401 without / with a wrong bearer token (same-length mismatch included)", async () => {
    envMock.CRON_SECRET = "correct-secretx";
    expect((await GET(makeRequest(null))).status).toBe(401);
    expect((await GET(makeRequest("Bearer correct-secretY"))).status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("runs the sweep with the configured batch size and returns counts only", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue(OK_RESULT);
    const response = await GET(makeRequest("Bearer correct-secret"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith({ batchSize: 40, dryRun: false });
    expect(body.result).toEqual(OK_RESULT);
  });

  it("?dryRun=1 requests a dry run (still authenticated)", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue({ ...OK_RESULT, dryRun: true });
    expect((await GET(makeRequest(null, "?dryRun=1"))).status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
    await GET(makeRequest("Bearer correct-secret", "?dryRun=1"));
    expect(mockExecute).toHaveBeenCalledWith({ batchSize: 40, dryRun: true });
  });

  it("any other dryRun value is a real run (never a silently skipped one)", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue(OK_RESULT);
    await GET(makeRequest("Bearer correct-secret", "?dryRun=true"));
    expect(mockExecute).toHaveBeenCalledWith({ batchSize: 40, dryRun: false });
  });

  it("a run with failed phases is a visible failure: 500 plus an operator message, not swallowed", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockResolvedValue({ ...OK_RESULT, outcome: "completed_with_failures", failedPhases: ["AUDIT"] });
    const response = await GET(makeRequest("Bearer correct-secret"));
    expect(response.status).toBe(500);
    expect(mockReportMessage).toHaveBeenCalledTimes(1);
  });

  it("an unexpected error is reported and returned without internals", async () => {
    envMock.CRON_SECRET = "correct-secret";
    mockExecute.mockRejectedValue(new Error("connection string postgresql://u:p@h/db leaked?"));
    const response = await GET(makeRequest("Bearer correct-secret"));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toMatch(/postgresql|leaked|connection/i);
    expect(mockReportException).toHaveBeenCalledTimes(1);
  });
});
