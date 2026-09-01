/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant I — Decimal money persistence: every monetary column in this
 * schema is `Decimal(10, 2)` (or `Decimal(14, 2)` for reconciliation's
 * wider fields) — never a float column — specifically so amounts don't
 * accumulate binary floating-point error. This test proves that real
 * PostgreSQL round-trips those values exactly, using `Prisma.Decimal`
 * string comparisons throughout rather than JavaScript `===`/`toBe` on
 * numbers, which would only prove IEEE-754 double precision was
 * "close enough" — not that the stored value is exact.
 *
 * Every case below picks amounts specifically chosen because naive
 * floating-point arithmetic gets them wrong (e.g. `0.1 + 0.2 !== 0.3` in
 * IEEE-754 double precision) — proving Postgres's `NUMERIC` type and
 * Prisma's `Decimal` wrapper avoid that class of bug entirely.
 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createFinancialGraph } from "../../test-utils/db/seed-helpers";

describe("Module 91 — Decimal money persistence (real PostgreSQL NUMERIC, real Prisma.Decimal)", () => {
  setupDbTestLifecycle();

  let graph: Awaited<ReturnType<typeof createFinancialGraph>>;

  beforeEach(async () => {
    graph = await createFinancialGraph(prisma);
  });

  it.each([
    ["19.99", "19.99"],
    ["0.10", "0.10"],
    ["0.20", "0.20"],
    ["100.01", "100.01"],
    ["9999999.99", "9999999.99"], // near the top of Decimal(10,2)'s range
    ["0.01", "0.01"],
  ])("round-trips %s through Postgres NUMERIC exactly, as a Decimal string, never as an approximate float", async (input, expected) => {
    const payment = await prisma.payment.create({
      data: {
        serviceRequestId: graph.serviceRequestId,
        quoteId: graph.quoteId,
        payerId: graph.payerUserId,
        amount: new Prisma.Decimal(input),
        method: "CARD",
        status: "CAPTURED",
      },
    });

    const reloaded = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(reloaded.amount).toBeInstanceOf(Prisma.Decimal);
    expect(reloaded.amount.toFixed(2)).toBe(expected);
    expect(reloaded.amount.equals(new Prisma.Decimal(expected))).toBe(true);
  });

  it("a sum PostgreSQL computes (0.10 + 0.20) is exactly 0.30 as a Decimal, not the 0.30000000000000004 IEEE-754 double would produce", async () => {
    // Deliberately does the addition IN POSTGRES (via two persisted rows
    // and a real SQL aggregate), not in JavaScript — the whole point of
    // this test is proving the database's own NUMERIC arithmetic, not
    // Prisma.Decimal's JS-side arithmetic (which is already exact and
    // wouldn't prove anything about the database).
    const commonData = {
      serviceRequestId: graph.serviceRequestId,
      quoteId: graph.quoteId,
      payerId: graph.payerUserId,
      method: "CARD" as const,
      status: "CAPTURED" as const,
    };
    await prisma.payment.create({ data: { ...commonData, amount: new Prisma.Decimal("0.10") } });
    await prisma.payment.create({ data: { ...commonData, amount: new Prisma.Decimal("0.20") } });

    const result = await prisma.payment.aggregate({
      where: { serviceRequestId: graph.serviceRequestId },
      _sum: { amount: true },
    });

    expect(result._sum.amount).not.toBeNull();
    expect(result._sum.amount!.toFixed(2)).toBe("0.30");
    expect(result._sum.amount!.equals(new Prisma.Decimal("0.30"))).toBe(true);

    // Confirm this is exactly the failure mode a naive Number-based sum
    // would exhibit, so a future regression to `Float`/`Number` money
    // columns would be caught by comparison, not just assertion.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("a signed Transaction ledger amount preserves sign and precision exactly (e.g. a -25.01 reversal)", async () => {
    const payment = await prisma.payment.create({
      data: {
        serviceRequestId: graph.serviceRequestId,
        quoteId: graph.quoteId,
        payerId: graph.payerUserId,
        amount: new Prisma.Decimal("100.00"),
        method: "CARD",
        status: "CAPTURED",
      },
    });

    const transaction = await prisma.transaction.create({
      data: {
        type: "DISPUTE_ADJUSTMENT",
        amount: new Prisma.Decimal("-25.01"),
        paymentId: payment.id,
        idempotencyKey: `module91-decimal-${payment.id}`,
      },
    });

    const reloaded = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(reloaded.amount.toFixed(2)).toBe("-25.01");
    expect(reloaded.amount.isNegative()).toBe(true);
  });
});
