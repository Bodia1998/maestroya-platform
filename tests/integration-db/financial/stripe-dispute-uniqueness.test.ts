/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant F — Stripe dispute uniqueness: proves
 * `StripeDispute.stripeDisputeId`'s unique index makes
 * `PrismaStripeDisputeRepository.createIfNotExists` — the atomic
 * repository method `ProcessStripeDisputeWebhookUseCase` depends on —
 * genuinely idempotent under concurrent duplicate `charge.dispute.created`
 * deliveries, not just in the application's own check-then-insert logic.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaStripeDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-stripe-dispute-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createCapturedPayment, createFinancialGraph } from "../../test-utils/db/seed-helpers";

function disputeData(overrides: { stripeDisputeId: string; paymentId: string | null; jobId: string | null }) {
  return {
    stripeDisputeId: overrides.stripeDisputeId,
    stripeChargeId: "ch_module91",
    stripePaymentIntentId: "pi_module91",
    paymentId: overrides.paymentId,
    jobId: overrides.jobId,
    amount: 75.25,
    currency: "EUR",
    reason: "fraudulent",
    status: "NEEDS_RESPONSE" as const,
    evidenceDueBy: null,
  };
}

describe("Module 91 — StripeDispute.stripeDisputeId uniqueness (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let paymentId: string;
  let jobId: string;

  beforeEach(async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph);
    paymentId = payment.id;
    jobId = graph.jobId;
  });

  it("createIfNotExists twice for the same stripeDisputeId returns created:false the second time, with the SAME row", async () => {
    const repository = new PrismaStripeDisputeRepository();
    const data = disputeData({ stripeDisputeId: "dp_module91_basic", paymentId, jobId });

    const first = await repository.createIfNotExists(data);
    expect(first.created).toBe(true);

    const second = await repository.createIfNotExists(data);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);

    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "stripe_disputes" WHERE "stripeDisputeId" = $1`,
      data.stripeDisputeId,
    );
    expect(rows).toHaveLength(1);
  });

  it("REAL CONCURRENT createIfNotExists calls (Promise.all) for the same stripeDisputeId produce exactly one row", async () => {
    const repository = new PrismaStripeDisputeRepository();
    const data = disputeData({ stripeDisputeId: "dp_module91_concurrent", paymentId, jobId });

    const results = await Promise.all(Array.from({ length: 8 }, () => repository.createIfNotExists(data)));

    const createdCount = results.filter((r) => r.created).length;
    expect(createdCount).toBe(1);

    const distinctIds = new Set(results.map((r) => r.record.id));
    expect(distinctIds.size).toBe(1);

    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "stripe_disputes" WHERE "stripeDisputeId" = $1`,
      data.stripeDisputeId,
    );
    expect(rows).toHaveLength(1);
  });

  it("a raw duplicate INSERT is rejected by the database itself, independent of the repository's own dedup logic", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "stripe_disputes" ("id", "stripeDisputeId", "amount", "currency", "status", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 50, 'EUR', 'NEEDS_RESPONSE', now(), now())`,
      "dp_module91_raw_duplicate",
    );

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "stripe_disputes" ("id", "stripeDisputeId", "amount", "currency", "status", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 999, 'EUR', 'NEEDS_RESPONSE', now(), now())`,
        "dp_module91_raw_duplicate",
      ),
    ).rejects.toThrow(/unique constraint|23505/i);
  });
});
