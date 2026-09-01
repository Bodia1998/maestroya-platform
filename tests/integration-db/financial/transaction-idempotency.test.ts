/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant D — Transaction idempotency: `Transaction.idempotencyKey` is
 * `@unique` in the schema, and `FinancialLedgerRepository.create`'s own
 * doc comment is explicit that `create()` does NOT dedupe on its own —
 * callers rely on the database's unique constraint (or a prior
 * `findByIdempotencyKey` check) as the actual backstop. This test proves
 * the database side of that contract for real, through the real
 * `PrismaFinancialLedgerRepository`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaFinancialLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-ledger-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createCapturedPayment, createFinancialGraph } from "../../test-utils/db/seed-helpers";

describe("Module 91 — Transaction.idempotencyKey uniqueness (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let paymentId: string;

  beforeEach(async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph);
    paymentId = payment.id;
  });

  it("a second create() with the same idempotencyKey is rejected by PostgreSQL, not silently accepted", async () => {
    const repository = new PrismaFinancialLedgerRepository();
    const idempotencyKey = `commission:${paymentId}`;

    const first = await repository.create({
      type: "COMMISSION",
      amount: 10,
      paymentId,
      idempotencyKey,
    });
    expect(first.idempotencyKey).toBe(idempotencyKey);

    await expect(
      repository.create({
        type: "COMMISSION",
        amount: 10,
        paymentId,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const rows = await prisma.transaction.findMany({ where: { idempotencyKey } });
    expect(rows).toHaveLength(1);
  });

  it("findByIdempotencyKey lets a caller check-before-write, and the constraint still holds if that check is skipped under concurrency", async () => {
    const repository = new PrismaFinancialLedgerRepository();
    const idempotencyKey = `dispute-adjustment:${paymentId}:REFUND`;

    expect(await repository.findByIdempotencyKey(idempotencyKey)).toBeNull();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        repository.create({
          type: "DISPUTE_ADJUSTMENT",
          amount: -25,
          paymentId,
          idempotencyKey,
        }),
      ),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(4);

    const found = await repository.findByIdempotencyKey(idempotencyKey);
    expect(found).not.toBeNull();

    const rows = await prisma.transaction.findMany({ where: { idempotencyKey } });
    expect(rows).toHaveLength(1);
  });

  it("two DIFFERENT idempotency keys for the same payment are both accepted (the constraint is on the key, not the payment)", async () => {
    const repository = new PrismaFinancialLedgerRepository();

    await repository.create({ type: "COMMISSION", amount: 10, paymentId, idempotencyKey: `commission:${paymentId}` });
    await repository.create({
      type: "DISPUTE_ADJUSTMENT",
      amount: -5,
      paymentId,
      idempotencyKey: `dispute-adjustment:${paymentId}:PARTIAL_REFUND`,
    });

    const rows = await prisma.transaction.findMany({ where: { paymentId } });
    expect(rows).toHaveLength(2);
  });
});
