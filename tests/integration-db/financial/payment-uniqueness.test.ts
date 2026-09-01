/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant A — Payment uniqueness: proves PostgreSQL itself (not just
 * application logic) prevents two `Payment` rows sharing the same
 * `stripePaymentIntentId`, and that `PrismaPaymentRepository.create` —
 * the real repository production code uses — is upsert-shaped
 * specifically to make a retried/duplicate capture return the original
 * row rather than erroring or double-creating.
 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createFinancialGraph } from "../../test-utils/db/seed-helpers";

describe("Module 91 — Payment.stripePaymentIntentId uniqueness (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let graph: Awaited<ReturnType<typeof createFinancialGraph>>;

  beforeEach(async () => {
    graph = await createFinancialGraph(prisma);
  });

  it("rejects a second Payment row with a duplicate stripePaymentIntentId via a raw insert", async () => {
    const stripePaymentIntentId = "pi_module91_duplicate_raw";

    await prisma.payment.create({
      data: {
        serviceRequestId: graph.serviceRequestId,
        quoteId: graph.quoteId,
        payerId: graph.payerUserId,
        amount: new Prisma.Decimal("100.00"),
        method: "CARD",
        status: "CAPTURED",
        stripePaymentIntentId,
      },
    });

    await expect(
      prisma.payment.create({
        data: {
          serviceRequestId: graph.serviceRequestId,
          quoteId: graph.quoteId,
          payerId: graph.payerUserId,
          amount: new Prisma.Decimal("100.00"),
          method: "CARD",
          status: "CAPTURED",
          stripePaymentIntentId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const rows = await prisma.payment.findMany({ where: { stripePaymentIntentId } });
    expect(rows).toHaveLength(1);
  });

  it("PrismaPaymentRepository.create is idempotent on stripePaymentIntentId: a retried call returns the same row, never a second one", async () => {
    const repository = new PrismaPaymentRepository();
    const stripePaymentIntentId = "pi_module91_repository_retry";

    const first = await repository.create({
      id: crypto.randomUUID(),
      serviceRequestId: graph.serviceRequestId,
      quoteId: graph.quoteId,
      payerId: graph.payerUserId,
      amount: 150.5,
      currency: "EUR",
      method: "CARD",
      stripePaymentIntentId,
    });

    // A different caller-supplied id — simulating a retried webhook
    // delivery that regenerated its own id but replayed the same Stripe
    // PaymentIntent — must still resolve to the FIRST row, not create a
    // second one and not throw.
    const second = await repository.create({
      id: crypto.randomUUID(),
      serviceRequestId: graph.serviceRequestId,
      quoteId: graph.quoteId,
      payerId: graph.payerUserId,
      amount: 999.99,
      currency: "EUR",
      method: "CARD",
      stripePaymentIntentId,
    });

    expect(second.id).toBe(first.id);
    expect(second.amount).toBe(first.amount);

    const rows = await prisma.payment.findMany({ where: { stripePaymentIntentId } });
    expect(rows).toHaveLength(1);
  });

  it("concurrent duplicate Payment creation via the real repository never produces two rows", async () => {
    const repository = new PrismaPaymentRepository();
    const stripePaymentIntentId = "pi_module91_concurrent";

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        repository.create({
          id: crypto.randomUUID(),
          serviceRequestId: graph.serviceRequestId,
          quoteId: graph.quoteId,
          payerId: graph.payerUserId,
          amount: 42,
          currency: "EUR",
          method: "CARD",
          stripePaymentIntentId,
        }),
      ),
    );

    const distinctIds = new Set(results.map((r) => r.id));
    expect(distinctIds.size).toBe(1);

    const rows = await prisma.payment.findMany({ where: { stripePaymentIntentId } });
    expect(rows).toHaveLength(1);
  });
});
