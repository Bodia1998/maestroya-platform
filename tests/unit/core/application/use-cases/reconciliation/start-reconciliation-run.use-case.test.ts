import { describe, expect, it } from "vitest";

import { StartReconciliationRunUseCase } from "@/application/use-cases/reconciliation/start-reconciliation-run.use-case";
import { ResolveDiscrepancyUseCase } from "@/application/use-cases/reconciliation/resolve-discrepancy.use-case";
import { ReconciliationRunStarted } from "@/domain/events/reconciliation-run-started";
import { ReconciliationRunCompleted } from "@/domain/events/reconciliation-run-completed";
import { ReconciliationRunFailed } from "@/domain/events/reconciliation-run-failed";
import { DiscrepancyDetected } from "@/domain/events/discrepancy-detected";
import { DiscrepancyResolved } from "@/domain/events/discrepancy-resolved";
import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type { StartReconciliationRunInput } from "@/application/dto/reconciliation.dto";
import { makeContext, makeCommission, makePayment, makePayout } from "../../../domain/reconciliation/fixtures";
import {
  FakeEventBus,
  FakeFailureReporter,
  FakeProviderFinancialReconciliationPort,
  FakeReconciliationDataSource,
  FakeReconciliationDiscrepancyRepository,
  FakeReconciliationRunRepository,
} from "./fakes";

function makeInput(overrides: Partial<StartReconciliationRunInput> = {}): StartReconciliationRunInput {
  return { scope: "FULL", limit: 500, ...overrides };
}

function makeHarness() {
  const dataSource = new FakeReconciliationDataSource();
  const runs = new FakeReconciliationRunRepository();
  const discrepancies = new FakeReconciliationDiscrepancyRepository();
  const provider = new FakeProviderFinancialReconciliationPort();
  const eventBus = new FakeEventBus();
  const failureReporter = new FakeFailureReporter();
  const useCase = new StartReconciliationRunUseCase(dataSource, runs, discrepancies, provider, eventBus, failureReporter);
  return { dataSource, runs, discrepancies, provider, eventBus, failureReporter, useCase };
}

/** Under scope=FULL the engine also evaluates PROVIDER checks against
 *  whatever `ProviderFinancialReconciliationPort` returns — the default
 *  fixture context carries a stripePaymentIntentId/stripeTransferId, so a
 *  provider port that knows nothing about them (the default
 *  `FakeProviderFinancialReconciliationPort`) correctly reports
 *  PROVIDER_STATE_UNKNOWN, exactly like `NullProviderReconciliationAdapter`
 *  would in production. A test that wants a job with zero findings at all
 *  — including PROVIDER — must stub matching provider state, which is
 *  what this helper does. */
function stubMatchingProviderState(provider: FakeProviderFinancialReconciliationPort): void {
  provider.paymentStates.set("pi_test_1", { found: true, settled: true, amount: 1000, currency: "EUR" });
  provider.transferStates.set("tr_test_1", { found: true, settled: true, amount: 900, currency: "EUR" });
}

describe("StartReconciliationRunUseCase", () => {
  it("completes with zero discrepancies for a fully clean job", async () => {
    const { dataSource, provider, useCase, eventBus } = makeHarness();
    dataSource.seed("job-1", makeContext());
    stubMatchingProviderState(provider);

    const summary = await useCase.execute(makeInput(), "admin-1");

    expect(summary.run.status).toBe("COMPLETED");
    expect(summary.run.recordsInspected).toBe(1);
    expect(summary.run.discrepancyCount).toBe(0);
    expect(summary.discrepanciesCreated).toBe(0);
    expect(eventBus.published.some((e) => e instanceof ReconciliationRunStarted)).toBe(true);
    expect(eventBus.published.some((e) => e instanceof ReconciliationRunCompleted)).toBe(true);
    expect(eventBus.published.some((e) => e instanceof DiscrepancyDetected)).toBe(false);
  });

  it("flags PROVIDER_STATE_UNKNOWN under scope=FULL when the provider port cannot verify a reference", async () => {
    const { dataSource, useCase, discrepancies } = makeHarness();
    dataSource.seed("job-1", makeContext());
    // No provider stub — mirrors NullProviderReconciliationAdapter.

    const summary = await useCase.execute(makeInput(), "admin-1");

    expect(summary.run.status).toBe("COMPLETED");
    const categories = [...discrepancies.byId.values()].map((d) => d.category);
    expect(categories.filter((c) => c === "PROVIDER_STATE_UNKNOWN")).toHaveLength(2); // payment + payout
  });

  it("detects and persists a payment amount mismatch", async () => {
    const { dataSource, useCase, discrepancies } = makeHarness();
    dataSource.seed("job-1", makeContext({ commission: makeCommission({ amount: 50 }) }));

    const summary = await useCase.execute(makeInput(), "admin-1");

    expect(summary.run.status).toBe("COMPLETED");
    expect(summary.discrepanciesCreated).toBeGreaterThan(0);
    const stored = [...discrepancies.byId.values()];
    expect(stored.some((d) => d.category === "COMMISSION_AMOUNT_MISMATCH")).toBe(true);
    expect(stored.every((d) => d.resolutionStatus === "OPEN")).toBe(true);
  });

  it("is idempotent: repeated runs against the same still-broken state reconfirm rather than duplicate", async () => {
    const { dataSource, useCase, discrepancies } = makeHarness();
    dataSource.seed("job-1", makeContext({ commission: makeCommission({ amount: 50 }) }));

    const first = await useCase.execute(makeInput(), "admin-1");
    const second = await useCase.execute(makeInput(), "admin-1");

    expect(first.discrepanciesCreated).toBeGreaterThan(0);
    expect(second.discrepanciesCreated).toBe(0);
    expect(second.discrepanciesReconfirmed).toBe(first.discrepanciesCreated);

    // Only one open row exists for the underlying condition — never one
    // row per run.
    const commissionMismatches = [...discrepancies.byId.values()].filter((d) => d.category === "COMMISSION_AMOUNT_MISMATCH");
    expect(commissionMismatches).toHaveLength(1);
    // But the second run's id is now the one that last confirmed it.
    expect(commissionMismatches[0]?.lastSeenRunId).toBe(second.run.id);
  });

  it("stays safe under concurrent/overlapping runs: two runs started in parallel each produce their own run row, and discrepancies still dedupe to one open row", async () => {
    const { dataSource, useCase, runs, discrepancies } = makeHarness();
    dataSource.seed("job-1", makeContext({ commission: makeCommission({ amount: 50 }) }));

    const [a, b] = await Promise.all([useCase.execute(makeInput(), "admin-1"), useCase.execute(makeInput(), "admin-2")]);

    expect(a.run.id).not.toBe(b.run.id);
    expect(runs.byId.size).toBe(2);
    expect([...runs.byId.values()].every((r) => r.status === "COMPLETED")).toBe(true);

    const commissionMismatches = [...discrepancies.byId.values()].filter((d) => d.category === "COMMISSION_AMOUNT_MISMATCH");
    expect(commissionMismatches).toHaveLength(1);
  });

  it("leaves a discrepancy OPEN across runs until an admin explicitly resolves it — a clean re-scan alone never resolves it", async () => {
    const { dataSource, provider, useCase, discrepancies } = makeHarness();
    dataSource.seed("job-1", makeContext({ commission: makeCommission({ amount: 50 }) }));
    stubMatchingProviderState(provider);
    await useCase.execute(makeInput(), "admin-1");

    // The underlying condition is fixed and the job no longer scanned as
    // broken, but the discrepancy row itself was never told to resolve.
    dataSource.seed("job-1", makeContext());
    await useCase.execute(makeInput(), "admin-1");

    const stored = [...discrepancies.byId.values()];
    expect(stored.every((d) => d.resolutionStatus === "OPEN")).toBe(true);
    const commissionMismatches = stored.filter((d) => d.category === "COMMISSION_AMOUNT_MISMATCH");
    expect(commissionMismatches).toHaveLength(1);
    expect(commissionMismatches[0]?.resolutionStatus).toBe("OPEN");
  });

  it("marks the run FAILED and never rethrows when the data source itself throws", async () => {
    const { dataSource, useCase, runs, eventBus } = makeHarness();
    dataSource.seed("job-1", makeContext());
    dataSource.getJobFinancialContext = async () => {
      throw new Error("simulated database outage");
    };

    const summary = await useCase.execute(makeInput(), "admin-1");

    expect(summary.run.status).toBe("FAILED");
    expect(summary.run.errorMessage).toContain("simulated database outage");
    expect(runs.byId.get(summary.run.id)?.status).toBe("FAILED");
    expect(eventBus.published.some((e) => e instanceof ReconciliationRunFailed)).toBe(true);
    expect(eventBus.published.some((e) => e instanceof ReconciliationRunCompleted)).toBe(false);
  });

  it("does not abort the whole run when a single PROVIDER lookup throws: the failure is reported, that one reference is skipped, and every other job/reference is still inspected and completes", async () => {
    const { dataSource, provider, useCase, runs, discrepancies, failureReporter } = makeHarness();
    dataSource.seed("job-1", makeContext());
    dataSource.seed(
      "job-2",
      makeContext({
        jobId: "job-2",
        payments: [makePayment({ id: "payment-2", jobId: "job-2", stripePaymentIntentId: "pi_test_2" })],
        commission: makeCommission({ paymentId: "payment-2" }),
      }),
    );
    provider.paymentStates.set("pi_test_2", { found: true, settled: true, amount: 1000, currency: "EUR" });
    stubMatchingProviderState(provider);
    // job-1's payment lookup blips (simulated Stripe timeout); job-2's
    // references are stubbed clean and must still be inspected.
    provider.nextErrorFor.set("pi_test_1", new Error("simulated Stripe timeout"));

    const summary = await useCase.execute(makeInput(), "admin-1");

    expect(summary.run.status).toBe("COMPLETED");
    expect(runs.byId.get(summary.run.id)?.status).toBe("COMPLETED");
    // Both jobs were inspected — the run did not stop after job-1's
    // provider call threw.
    expect(summary.run.recordsInspected).toBe(2);
    // The failing reference produced no false PROVIDER_STATE_UNKNOWN (or
    // any other) discrepancy — it was skipped, not misreported.
    const stored = [...discrepancies.byId.values()];
    expect(stored.filter((d) => d.entityId === "payment-1" || d.jobId === "job-1")).toHaveLength(0);
    // But the failure itself is observable, never silently swallowed.
    expect(failureReporter.reports).toHaveLength(1);
    expect(failureReporter.reports[0]?.context).toMatchObject({
      jobId: "job-1",
      reason: "provider_reconciliation_lookup_failed",
    });
  });

  it("skips a job the data source can no longer resolve to a context, without failing the run", async () => {
    const { dataSource, useCase } = makeHarness();
    dataSource.seed("job-1", makeContext());
    const original = dataSource.getJobFinancialContext.bind(dataSource);
    dataSource.getJobFinancialContext = async (jobId: string) => (jobId === "job-1" ? null : original(jobId));

    const summary = await useCase.execute(makeInput(), "admin-1");

    expect(summary.run.status).toBe("COMPLETED");
    expect(summary.run.recordsInspected).toBe(0);
  });

  it("only evaluates PAYOUT checks when scope=PAYOUT, never commission/tax/invoice checks", async () => {
    const { dataSource, useCase, discrepancies } = makeHarness();
    dataSource.seed(
      "job-1",
      makeContext({
        commission: makeCommission({ amount: 50 }), // would trigger a COMMISSION finding under FULL
        payout: makePayout({ amount: 1 }), // triggers a PAYOUT finding regardless of scope
      }),
    );

    await useCase.execute(makeInput({ scope: "PAYOUT" }), "admin-1");

    const categories = [...discrepancies.byId.values()].map((d) => d.category);
    expect(categories.some((c) => c.startsWith("PAYOUT"))).toBe(true);
    expect(categories.some((c) => c.startsWith("COMMISSION"))).toBe(false);
  });

  it("assigns run-level provenance so a manually-triggered run always carries the triggering admin's id", async () => {
    const { dataSource, useCase } = makeHarness();
    dataSource.seed("job-1", makeContext());
    const summary = await useCase.execute(makeInput(), "admin-42");
    expect(summary.run.triggeredByUserId).toBe("admin-42");
  });

  // Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor:
  // the internal-only `jobIds` escape hatch `RunScheduledReconciliationSweepUseCase`
  // uses to drive this engine over a cursor-selected batch.
  it("jobIds, when provided, is reconciled exactly instead of calling dataSource.listJobIdsToInspect", async () => {
    const { dataSource, useCase } = makeHarness();
    dataSource.seed("job-1", makeContext());
    dataSource.seed("job-2", makeContext());
    dataSource.seed("job-3", makeContext());

    const summary = await useCase.execute({ ...makeInput(), jobIds: ["job-2"] }, null);

    expect(summary.run.recordsInspected).toBe(1);
  });

  it("jobIds=[] reconciles zero Jobs (a legitimate empty batch), not the dataSource's full default list", async () => {
    const { dataSource, useCase } = makeHarness();
    dataSource.seed("job-1", makeContext());

    const summary = await useCase.execute({ ...makeInput(), jobIds: [] }, null);

    expect(summary.run.recordsInspected).toBe(0);
    expect(summary.run.status).toBe("COMPLETED");
  });

  it("omitting jobIds preserves the existing since/limit dataSource.listJobIdsToInspect behavior", async () => {
    const { dataSource, useCase } = makeHarness();
    dataSource.seed("job-1", makeContext());
    dataSource.seed("job-2", makeContext());

    const summary = await useCase.execute(makeInput({ limit: 1 }), "admin-1");

    expect(summary.run.recordsInspected).toBe(1);
  });
});

describe("ResolveDiscrepancyUseCase (manual-only resolution)", () => {
  it("resolves an OPEN discrepancy and publishes DiscrepancyResolved", async () => {
    const { dataSource, useCase: startRun, discrepancies, eventBus } = makeHarness();
    dataSource.seed("job-1", makeContext({ commission: makeCommission({ amount: 50 }) }));
    await startRun.execute(makeInput(), "admin-1");
    const [discrepancy] = [...discrepancies.byId.values()];
    if (!discrepancy) throw new Error("expected a discrepancy to have been detected");

    const resolveUseCase = new ResolveDiscrepancyUseCase(discrepancies, eventBus);
    const resolved = await resolveUseCase.execute(discrepancy.id, "admin-1", "Verified against accountant records — false positive.");

    expect(resolved.resolutionStatus).toBe("RESOLVED");
    expect(resolved.resolution?.resolvedByUserId).toBe("admin-1");
    expect(eventBus.published.some((e) => e instanceof DiscrepancyResolved)).toBe(true);
  });

  it("throws NotFoundError for an unknown discrepancy id", async () => {
    const { discrepancies, eventBus } = makeHarness();
    const resolveUseCase = new ResolveDiscrepancyUseCase(discrepancies, eventBus);
    await expect(resolveUseCase.execute("nonexistent-id", "admin-1", "reason")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError when resolving an already-resolved discrepancy — resolution is never re-applied", async () => {
    const { dataSource, useCase: startRun, discrepancies, eventBus } = makeHarness();
    dataSource.seed("job-1", makeContext({ commission: makeCommission({ amount: 50 }) }));
    await startRun.execute(makeInput(), "admin-1");
    const [discrepancy] = [...discrepancies.byId.values()];
    if (!discrepancy) throw new Error("expected a discrepancy to have been detected");

    const resolveUseCase = new ResolveDiscrepancyUseCase(discrepancies, eventBus);
    await resolveUseCase.execute(discrepancy.id, "admin-1", "first resolution");

    await expect(resolveUseCase.execute(discrepancy.id, "admin-2", "second attempt")).rejects.toBeInstanceOf(ConflictError);
  });

  it("never resolves automatically — a discrepancy stays OPEN forever until this use case is explicitly invoked", async () => {
    const { dataSource, useCase: startRun, discrepancies } = makeHarness();
    dataSource.seed("job-1", makeContext({ commission: makeCommission({ amount: 50 }) }));
    await startRun.execute(makeInput(), "admin-1");
    await startRun.execute(makeInput(), "admin-1");
    await startRun.execute(makeInput(), "admin-1");

    const stored = [...discrepancies.byId.values()];
    expect(stored.every((d) => d.resolutionStatus === "OPEN")).toBe(true);
  });
});
