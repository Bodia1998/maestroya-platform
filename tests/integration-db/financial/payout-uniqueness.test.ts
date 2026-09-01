/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant C — Payout uniqueness (the production-readiness audit's
 * highest-priority item here): proves PostgreSQL's unique index on
 * `Payout.jobId` makes double-payout for the same Job impossible, even
 * under genuine concurrency — `ExecuteProfessionalPayoutUseCase`'s
 * application-level idempotency check is not what this test is about;
 * this proves the database-level backstop that check's own doc comment
 * says exists for exactly this reason.
 *
 * `PrismaPayoutRepository` is written against raw SQL (`$queryRawUnsafe`)
 * rather than `prisma.payout.*` — see that class's own doc comment — but
 * every value is still a bound parameter, and its `createPending` is
 * exactly the real production code path (`INSERT ... ON CONFLICT ("jobId")
 * DO NOTHING`) this test exercises.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaPayoutRepository } from "@/infrastructure/database/prisma/repositories/prisma-payout-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createCapturedPayment, createFinancialGraph } from "../../test-utils/db/seed-helpers";

describe("Module 91 — Payout.jobId uniqueness (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let jobId: string;
  let paymentId: string;
  let professionalProfileId: string;

  beforeEach(async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph);
    jobId = graph.jobId;
    paymentId = payment.id;
    professionalProfileId = graph.professionalProfileId;
  });

  it("createPending twice sequentially for the same jobId returns the SAME row, never creates a second one", async () => {
    const repository = new PrismaPayoutRepository();

    const first = await repository.createPending({
      jobId,
      paymentId,
      professionalProfileId,
      companyProfileId: null,
      amount: 90,
      currency: "EUR",
      idempotencyKey: `payout:${jobId}`,
    });

    const second = await repository.createPending({
      jobId,
      paymentId,
      professionalProfileId,
      companyProfileId: null,
      amount: 90,
      currency: "EUR",
      idempotencyKey: `payout:${jobId}`,
    });

    expect(second.id).toBe(first.id);

    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "payouts" WHERE "jobId" = $1::uuid`, jobId);
    expect(rows).toHaveLength(1);
  });

  it("REAL CONCURRENT createPending calls for the same jobId (Promise.all, not sequential) produce exactly one Payout row", async () => {
    const repository = new PrismaPayoutRepository();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.createPending({
          jobId,
          paymentId,
          professionalProfileId,
          companyProfileId: null,
          amount: 90,
          currency: "EUR",
          idempotencyKey: `payout:${jobId}`,
        }),
      ),
    );

    // Every concurrent caller must resolve (createPending never throws on
    // conflict — it re-reads and returns the winner's row), and every one
    // of them must report the SAME payout id.
    const distinctIds = new Set(results.map((r) => r.id));
    expect(distinctIds.size).toBe(1);

    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "payouts" WHERE "jobId" = $1::uuid`, jobId);
    expect(rows).toHaveLength(1);
  });

  it("a raw duplicate INSERT without ON CONFLICT is rejected by the database itself (proves the unique index exists independent of application code)", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "payouts" ("id", "jobId", "paymentId", "professionalProfileId", "amount", "currency", "status", "attemptCount", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 90, 'EUR', 'PENDING', 0, now(), now())`,
      jobId,
      paymentId,
      professionalProfileId,
    );

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "payouts" ("id", "jobId", "paymentId", "professionalProfileId", "amount", "currency", "status", "attemptCount", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 90, 'EUR', 'PENDING', 0, now(), now())`,
        jobId,
        paymentId,
        professionalProfileId,
      ),
    ).rejects.toThrow(/unique constraint|23505/i);
  });
});
