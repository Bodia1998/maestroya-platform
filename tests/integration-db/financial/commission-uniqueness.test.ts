/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant B — Commission uniqueness: proves PostgreSQL's unique index
 * on `Commission.paymentId` prevents two commission records for the same
 * Payment, and that `PrismaCommissionRepository.create` — used by
 * `RecordCommissionForPaymentUseCase` — surfaces that as a real
 * constraint violation rather than silently succeeding twice.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createCapturedPayment, createFinancialGraph } from "../../test-utils/db/seed-helpers";

describe("Module 91 — Commission.paymentId uniqueness (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let paymentId: string;

  beforeEach(async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph);
    paymentId = payment.id;
  });

  it("rejects a second Commission row for a payment that already has one", async () => {
    const repository = new PrismaCommissionRepository();

    await repository.create({
      paymentId,
      professionalProfileId: null,
      companyProfileId: null,
      rateBps: 1000,
      amount: 10,
    });

    await expect(
      repository.create({
        paymentId,
        professionalProfileId: null,
        companyProfileId: null,
        rateBps: 1000,
        amount: 10,
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const rows = await prisma.commission.findMany({ where: { paymentId } });
    expect(rows).toHaveLength(1);
  });

  it("concurrent commission creation for the same payment produces exactly one row and one thrown error", async () => {
    const repository = new PrismaCommissionRepository();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        repository.create({
          paymentId,
          professionalProfileId: null,
          companyProfileId: null,
          rateBps: 1000,
          amount: 10,
        }),
      ),
    );

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const outcome of rejected) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toMatchObject({ code: "P2002" });
      }
    }

    const rows = await prisma.commission.findMany({ where: { paymentId } });
    expect(rows).toHaveLength(1);
  });
});
