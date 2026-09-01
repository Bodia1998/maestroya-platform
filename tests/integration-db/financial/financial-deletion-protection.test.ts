/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant H — financial deletion protection: several financial
 * relationships are declared `onDelete: Restrict` in schema.prisma
 * (Payment -> ServiceRequest/Quote/Payer User, Commission -> Payment,
 * Transaction -> Payment/Payout/Commission, Payout -> ...). This proves
 * that a real `DELETE` against a parent row with financial history
 * attached is rejected by PostgreSQL's own foreign-key constraint —
 * never silently cascades — for the relationships the audit called out
 * as the ones that matter most: Payment, Commission, and Payout history.
 *
 * Reading the schema/migration is not enough here: Prisma's
 * `onDelete: Restrict` only controls what SQL Prisma *generates* for the
 * FK constraint; this test proves the constraint that actually landed in
 * the database behaves as intended by attempting the real `DELETE`.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createCapturedPayment, createFinancialGraph } from "../../test-utils/db/seed-helpers";

describe("Module 91 — financial deletion protection (onDelete: Restrict, real PostgreSQL)", () => {
  setupDbTestLifecycle();

  it("deleting a Payment that has a Commission is rejected — commission history can never be silently cascade-deleted", async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph);
    await prisma.commission.create({
      data: { paymentId: payment.id, professionalProfileId: graph.professionalProfileId, rateBps: 1000, amount: 10 },
    });

    await expect(prisma.payment.delete({ where: { id: payment.id } })).rejects.toMatchObject({ code: "P2003" });

    // The Payment AND its Commission must both still exist afterward.
    expect(await prisma.payment.findUnique({ where: { id: payment.id } })).not.toBeNull();
    expect(await prisma.commission.findUnique({ where: { paymentId: payment.id } })).not.toBeNull();
  });

  it("deleting a Payment that has a Transaction ledger entry is rejected", async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph);
    await prisma.transaction.create({
      data: { type: "CHARGE", amount: 100, paymentId: payment.id, idempotencyKey: `charge:${payment.id}` },
    });

    await expect(prisma.payment.delete({ where: { id: payment.id } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("deleting a ServiceRequest that has a captured Payment is rejected — a request can never be removed out from under its financial history", async () => {
    const graph = await createFinancialGraph(prisma);
    await createCapturedPayment(prisma, graph);

    await expect(prisma.serviceRequest.delete({ where: { id: graph.serviceRequestId } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("deleting a Commission that has a Transaction referencing it is rejected", async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph);
    const commission = await prisma.commission.create({
      data: { paymentId: payment.id, professionalProfileId: graph.professionalProfileId, rateBps: 1000, amount: 10 },
    });
    await prisma.transaction.create({
      data: { type: "COMMISSION", amount: 10, commissionId: commission.id, idempotencyKey: `commission-tx:${commission.id}` },
    });

    await expect(prisma.commission.delete({ where: { id: commission.id } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("deleting a Payout that has a Transaction referencing it is rejected", async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph);
    const payout = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO "payouts" ("id", "jobId", "paymentId", "professionalProfileId", "amount", "currency", "status", "attemptCount", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 90, 'EUR', 'PAID', 0, now(), now())
       RETURNING "id"`,
      graph.jobId,
      payment.id,
      graph.professionalProfileId,
    );
    const payoutId = payout[0]!.id;
    await prisma.transaction.create({
      data: { type: "PAYOUT", amount: -90, payoutId, idempotencyKey: `payout-tx:${payoutId}` },
    });

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "payouts" WHERE "id" = $1::uuid`, payoutId),
    ).rejects.toThrow(/foreign key constraint|23503/i);
  });
});
