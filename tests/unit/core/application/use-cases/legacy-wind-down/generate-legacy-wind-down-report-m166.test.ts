import { describe, expect, it, vi } from "vitest";

import { GenerateLegacyWindDownReportUseCase } from "@/application/use-cases/legacy-wind-down/generate-legacy-wind-down-report.use-case";
import type { LegacyWindDownReader } from "@/domain/repositories/legacy-wind-down-reader";
import { LEGACY_WIND_DOWN_NOTICE, LEGACY_WIND_DOWN_RULES_VERSION, LegacyWindDownScopeTooLargeError, type LegacyWindDownSnapshot } from "@/domain/services/legacy-wind-down";

const D = (s: string) => new Date(s);

function snapshot(over: Partial<LegacyWindDownSnapshot> = {}): LegacyWindDownSnapshot {
  return {
    serviceRequests: [],
    quotes: [],
    jobs: [],
    completionConfirmations: [],
    unconfirmedPayments: [],
    capturedPayments: [],
    payouts: [],
    refunds: [],
    financialAdjustments: [],
    disputeResolutionDecisions: [],
    disputes: [],
    stripeDisputes: [],
    invoices: [],
    creditNotes: [],
    affiliateCommissions: [],
    webhookEvents: [],
    reconciliation: {
      openDiscrepancies: { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 },
      latestCompletedFullRun: { id: "run-1", startedAt: D("2026-10-01T00:00:00Z"), completedAt: D("2026-10-01T00:05:00Z"), discrepancyCount: 0, recordsInspected: 7 },
      runningRunCount: 0,
    },
    latestLegacyFinancialChangeAt: D("2026-09-30T00:00:00Z"),
    legacyRequestTotal: 0,
    newestLegacyRequestCreatedAt: null,
    ...over,
  };
}

const readerOf = (s: LegacyWindDownSnapshot): LegacyWindDownReader & { readSnapshot: ReturnType<typeof vi.fn> } => ({ readSnapshot: vi.fn(async () => s) });

describe("M166 — GenerateLegacyWindDownReportUseCase", () => {
  it("reads exactly one snapshot, adds the notice, rules version and the injected clock, and summarises", async () => {
    const reader = readerOf(
      snapshot({
        quotes: [{ id: "q1", status: "SENT", validUntil: null }],
        stripeDisputes: [{ id: "d1", status: "NEEDS_RESPONSE", amount: "9.00", currency: "EUR", financialAdjustmentId: null }],
      }),
    );
    const now = D("2026-10-15T10:00:00Z");
    const report = await new GenerateLegacyWindDownReportUseCase(reader, () => now).execute();

    expect(reader.readSnapshot).toHaveBeenCalledTimes(1);
    expect(report.generatedAt).toBe(now);
    expect(report.rulesVersion).toBe(LEGACY_WIND_DOWN_RULES_VERSION);
    expect(report.notice).toBe(LEGACY_WIND_DOWN_NOTICE);
    expect(report.notice).toMatch(/can never declare Gate C passed/);
    expect(report.readiness.decision).toBe("NOT_READY");
    expect(report.summary).toEqual({
      totalItems: 2,
      totalObjects: 2,
      bySeverity: { INFO: 0, WARNING: 1, ERROR: 0, CRITICAL: 1 },
      byCode: { LEGACY_QUOTE_OPEN: 1, LEGACY_STRIPE_DISPUTE_OPEN: 1 },
    });
  });

  it("a clean snapshot yields DATA_CLEAN_PENDING_SIGN_OFF — and the report still lists every external confirmation as unverified", async () => {
    const report = await new GenerateLegacyWindDownReportUseCase(readerOf(snapshot())).execute();
    expect(report.readiness.decision).toBe("DATA_CLEAN_PENDING_SIGN_OFF");
    expect(report.summary.totalItems).toBe(0);
    expect(report.readiness.externalConfirmations.length).toBeGreaterThanOrEqual(7);
    expect(report.readiness.externalConfirmations.every((c) => c.status === "NOT_VERIFIABLE_FROM_REPOSITORY")).toBe(true);
  });

  it("FAILS CLOSED: a reader failure propagates and never becomes an empty or clean report", async () => {
    const boom = new Error("database unavailable");
    const reader: LegacyWindDownReader = { readSnapshot: vi.fn().mockRejectedValue(boom) };
    await expect(new GenerateLegacyWindDownReportUseCase(reader).execute()).rejects.toBe(boom);
  });

  it("FAILS CLOSED: an oversized inventory propagates the scope error instead of reporting a subset", async () => {
    const reader: LegacyWindDownReader = { readSnapshot: vi.fn().mockRejectedValue(new LegacyWindDownScopeTooLargeError("payments(captured)", 10)) };
    await expect(new GenerateLegacyWindDownReportUseCase(reader).execute()).rejects.toBeInstanceOf(LegacyWindDownScopeTooLargeError);
  });

  it("is repeatable: two runs over the same data give identical findings (only generatedAt may differ) and touch nothing", async () => {
    const s = snapshot({ quotes: [{ id: "q1", status: "SENT", validUntil: null }] });
    const reader = readerOf(s);
    const uc = new GenerateLegacyWindDownReportUseCase(reader);
    const a = await uc.execute();
    const b = await uc.execute();
    const { generatedAt: _a, ...restA } = a;
    const { generatedAt: _b, ...restB } = b;
    expect(restB).toEqual(restA);
    // The only capability the use case holds is a single query-only method.
    expect(Object.keys(reader)).toEqual(["readSnapshot"]);
  });
});
