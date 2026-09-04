/**
 * Module 96 Financial Fix Pass — Invariant: at most one PENDING/PROCESSING
 * PartnerPayout per partner, and a commission can never be claimed by two
 * payouts, even under genuine concurrency. Proves the partial unique index
 * (migration `20260916000000_add_partner_payout_inflight_unique_index`)
 * and `PrismaPartnerPayoutRepository.createBatch`'s atomic claim
 * transaction — not `CreatePartnerPayoutUseCase`'s application logic,
 * which this suite does not even invoke.
 *
 * STATUS AT AUTHORING TIME: written against the real Module 91 harness,
 * NOT executed — this sandbox has no reachable Postgres
 * (`TEST_DATABASE_URL`/`DATABASE_URL` unset, confirmed via
 * `npm run test:integration:db`'s own startup error). Treat as PENDING
 * execution, not a passing result, until run against a real database.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaPartnerPayoutRepository } from "@/infrastructure/database/prisma/repositories/prisma-partner-payout-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createApprovedAffiliateCommission, createApprovedPartner } from "./seed-helpers";

describe("Module 96 Financial Fix Pass — PartnerPayout in-flight uniqueness (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let partnerId: string;
  let commissionIds: string[];

  beforeEach(async () => {
    const partner = await createApprovedPartner(prisma);
    partnerId = partner.id;
    const commissions = await Promise.all(
      Array.from({ length: 3 }, () => createApprovedAffiliateCommission(prisma, partnerId, { affiliateAmount: 20 })),
    );
    commissionIds = commissions.map((c) => c.id);
  });

  it("REAL CONCURRENT createBatch calls for the same partner (Promise.all) — exactly one succeeds, the rest reject", async () => {
    const repository = new PrismaPartnerPayoutRepository();
    const periodStart = new Date("2026-01-01T00:00:00Z");
    const periodEnd = new Date("2026-01-31T00:00:00Z");

    const attempts = Array.from({ length: 5 }, () =>
      repository
        .createBatch({ partnerId, amount: 60, method: "MANUAL", periodStart, periodEnd }, commissionIds)
        .then((payout) => ({ ok: true as const, payout }))
        .catch((error) => ({ ok: false as const, error })),
    );
    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(4);

    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "partner_payouts" WHERE "partnerId" = $1::uuid AND "status" IN ('PENDING', 'PROCESSING')`,
      partnerId,
    );
    expect(rows).toHaveLength(1);

    // Every commission was claimed by the ONE winning payout — never
    // split across two, never left unclaimed.
    const claimed = await prisma.affiliateCommission.findMany({ where: { id: { in: commissionIds } }, select: { payoutId: true } });
    expect(claimed.every((c) => c.payoutId === rows[0]!.id)).toBe(true);
  });

  it("a raw duplicate PENDING payout insert for the same partner is rejected by the database itself", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "partner_payouts" ("id", "partnerId", "amount", "currency", "method", "status", "periodStart", "periodEnd", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, 60, 'EUR', 'MANUAL', 'PENDING', now(), now(), now(), now())`,
      partnerId,
    );

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "partner_payouts" ("id", "partnerId", "amount", "currency", "method", "status", "periodStart", "periodEnd", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1::uuid, 60, 'EUR', 'MANUAL', 'PROCESSING', now(), now(), now(), now())`,
        partnerId,
      ),
    ).rejects.toThrow(/unique constraint|23505/i);
  });

  it("a FAILED payout does not block a new one — the partial index only covers PENDING/PROCESSING", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "partner_payouts" ("id", "partnerId", "amount", "currency", "method", "status", "periodStart", "periodEnd", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, 60, 'EUR', 'MANUAL', 'FAILED', now(), now(), now(), now())`,
      partnerId,
    );

    const repository = new PrismaPartnerPayoutRepository();
    const payout = await repository.createBatch(
      { partnerId, amount: 60, method: "MANUAL", periodStart: new Date(), periodEnd: new Date() },
      commissionIds,
    );
    expect(payout.status).toBe("PENDING");
  });

  it("createBatch releases nothing and throws when one of the requested commissions is already claimed by another payout", async () => {
    const repository = new PrismaPartnerPayoutRepository();

    // A real second partner + payout, so commissionIds[0]'s payoutId FK
    // is satisfiable — simulates "a prior payout already claimed this
    // commission," isolating exactly the claim-count-mismatch branch
    // without going through a second createBatch call.
    const otherPartner = await createApprovedPartner(prisma);
    const otherPayout = await prisma.partnerPayout.create({
      data: {
        partnerId: otherPartner.id,
        amount: 1,
        currency: "EUR",
        method: "MANUAL",
        status: "PENDING",
        periodStart: new Date(),
        periodEnd: new Date(),
      },
    });
    await prisma.affiliateCommission.update({ where: { id: commissionIds[0]! }, data: { payoutId: otherPayout.id } });

    await expect(
      repository.createBatch(
        { partnerId, amount: 60, method: "MANUAL", periodStart: new Date(), periodEnd: new Date() },
        commissionIds,
      ),
    ).rejects.toThrow(/could not claim/i);

    // The payout row itself must have rolled back along with the failed
    // claim — never left behind as an orphaned PENDING payout claiming
    // only 2 of 3 commissions.
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "partner_payouts" WHERE "partnerId" = $1::uuid`,
      partnerId,
    );
    expect(rows).toHaveLength(0);
  });
});
