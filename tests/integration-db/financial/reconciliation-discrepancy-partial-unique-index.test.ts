/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant G — the reconciliation partial unique index
 * (`reconciliation_discrepancies_open_fingerprint_unique`, added by
 * `prisma/migrations/20260907000000_add_financial_reconciliation_module`):
 * "at most one OPEN discrepancy per fingerprint, but a fingerprint may
 * recur any number of times among RESOLVED rows." This is a `WHERE
 * "resolutionStatus" = 'OPEN'` partial index — the kind of constraint a
 * migration-file inspection can misjudge (it's easy to assume a plain
 * unique index and only notice the `WHERE` clause on close reading). This
 * suite executes real inserts/updates against it rather than just
 * reading the SQL.
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaReconciliationDiscrepancyRepository } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-discrepancy-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createFinancialGraph, createReconciliationRun } from "../../test-utils/db/seed-helpers";

describe("Module 91 — reconciliation_discrepancies_open_fingerprint_unique (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let runId: string;
  let jobId: string;
  let resolverUserId: string;

  beforeEach(async () => {
    const run = await createReconciliationRun(prisma);
    const graph = await createFinancialGraph(prisma);
    runId = run.id;
    jobId = graph.jobId;
    resolverUserId = graph.professionalUserId;
  });

  function discrepancyData(fingerprint: string) {
    return {
      id: randomUUID(),
      detectedByRunId: runId,
      lastSeenRunId: runId,
      entityType: "PAYOUT" as const,
      entityId: null,
      jobId,
      paymentId: null,
      invoiceId: null,
      payoutId: null,
      refundId: null,
      creditNoteId: null,
      category: "DUPLICATE_PAYOUT" as const,
      severity: "CRITICAL" as const,
      expectedValue: null,
      actualValue: null,
      differenceValue: null,
      currency: "EUR",
      explanation: "Module 91 real-DB test discrepancy.",
      fingerprint,
      detectedAt: new Date(),
    };
  }

  it("a raw second INSERT of an OPEN row with the same fingerprint is rejected by the partial unique index itself", async () => {
    const fingerprint = "module91-raw-fingerprint";
    await prisma.reconciliationDiscrepancy.create({ data: discrepancyData(fingerprint) });

    await expect(
      prisma.reconciliationDiscrepancy.create({ data: discrepancyData(fingerprint) }),
    ).rejects.toMatchObject({ code: "P2002" });

    const openRows = await prisma.reconciliationDiscrepancy.findMany({
      where: { fingerprint, resolutionStatus: "OPEN" },
    });
    expect(openRows).toHaveLength(1);
  });

  it("createOrTouch never creates a second OPEN row for the same fingerprint — it touches the existing one instead", async () => {
    const repository = new PrismaReconciliationDiscrepancyRepository();
    const fingerprint = "module91-createOrTouch-fingerprint";

    const first = await repository.createOrTouch(discrepancyData(fingerprint));
    expect(first.created).toBe(true);

    const secondRun = await createReconciliationRun(prisma);
    const second = await repository.createOrTouch({
      ...discrepancyData(fingerprint),
      id: randomUUID(),
      detectedByRunId: secondRun.id,
    });

    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    // touch() re-points lastSeenRunId at the run that re-detected it —
    // proof this is a real touch, not a no-op duplicate check.
    expect(second.record.lastSeenRunId).toBe(secondRun.id);

    const openRows = await prisma.reconciliationDiscrepancy.findMany({
      where: { fingerprint, resolutionStatus: "OPEN" },
    });
    expect(openRows).toHaveLength(1);
  });

  it("REAL CONCURRENT createOrTouch calls (Promise.all) for the same fingerprint never produce two OPEN rows", async () => {
    const repository = new PrismaReconciliationDiscrepancyRepository();
    const fingerprint = "module91-concurrent-fingerprint";

    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.createOrTouch({ ...discrepancyData(fingerprint), id: randomUUID() })),
    );

    const createdCount = results.filter((r) => r.created).length;
    expect(createdCount).toBe(1);

    const distinctIds = new Set(results.map((r) => r.record.id));
    expect(distinctIds.size).toBe(1);

    const openRows = await prisma.reconciliationDiscrepancy.findMany({
      where: { fingerprint, resolutionStatus: "OPEN" },
    });
    expect(openRows).toHaveLength(1);
  });

  it("a RESOLVED discrepancy does NOT block a later OPEN one with the same fingerprint — the intended behavior of the partial index", async () => {
    const fingerprint = "module91-resolved-then-reopen-fingerprint";
    const repository = new PrismaReconciliationDiscrepancyRepository();

    const original = await repository.createOrTouch(discrepancyData(fingerprint));
    expect(original.created).toBe(true);

    await repository.resolve({
      id: original.record.id,
      resolvedByUserId: resolverUserId,
      resolvedAt: new Date(),
      reason: "Module 91 test resolution.",
      metadata: null,
    });

    // A brand-new occurrence of the same underlying fingerprint (e.g. the
    // same duplicate-payout pattern recurring on a later reconciliation
    // run) must be free to open again — the partial index only excludes
    // OPEN rows from the uniqueness check, RESOLVED rows are exempt by
    // design (see the migration's own doc comment).
    const reopened = await repository.createOrTouch({ ...discrepancyData(fingerprint), id: randomUUID() });
    expect(reopened.created).toBe(true);
    expect(reopened.record.id).not.toBe(original.record.id);

    const allRowsForFingerprint = await prisma.reconciliationDiscrepancy.findMany({ where: { fingerprint } });
    expect(allRowsForFingerprint).toHaveLength(2);

    const openRows = allRowsForFingerprint.filter((r) => r.resolutionStatus === "OPEN");
    const resolvedRows = allRowsForFingerprint.filter((r) => r.resolutionStatus === "RESOLVED");
    expect(openRows).toHaveLength(1);
    expect(resolvedRows).toHaveLength(1);
  });

  it("a raw INSERT of a RESOLVED row with a fingerprint that already has an OPEN row is allowed (the index only constrains OPEN rows)", async () => {
    const fingerprint = "module91-resolved-alongside-open-fingerprint";
    await prisma.reconciliationDiscrepancy.create({ data: discrepancyData(fingerprint) });

    await expect(
      prisma.reconciliationDiscrepancy.create({
        data: {
          ...discrepancyData(fingerprint),
          id: randomUUID(),
          resolutionStatus: "RESOLVED",
          resolvedByUserId: resolverUserId,
          resolvedAt: new Date(),
          resolutionReason: "Historical resolved occurrence.",
        },
      }),
    ).resolves.toBeDefined();

    const rows = await prisma.reconciliationDiscrepancy.findMany({ where: { fingerprint } });
    expect(rows).toHaveLength(2);
  });
});
