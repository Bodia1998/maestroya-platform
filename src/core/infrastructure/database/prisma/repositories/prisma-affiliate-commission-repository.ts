import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AffiliateCommissionRecord,
  AffiliateCommissionRepository,
  AffiliateCommissionStatusValue,
  AffiliateEarningsTotals,
  CreateAffiliateCommissionData,
} from "@/domain/repositories/affiliate-commission-repository";

/**
 * Module 61 — Affiliate & Partner System: Prisma implementation of
 * `AffiliateCommissionRepository`, backed by the `affiliate_commissions`
 * table. `platformCommissionAmount`/`affiliateAmount` are stored as
 * Prisma's `Decimal` and converted to/from `number` here — same convention
 * `PrismaConversionEventRepository` uses for `revenueAmount`.
 */
const AFFILIATE_COMMISSION_SELECT = {
  id: true,
  partnerId: true,
  referralCode: true,
  conversionEventId: true,
  platformCommissionRefId: true,
  platformCommissionAmount: true,
  attributableCostAmount: true,
  profitBaseAmount: true,
  affiliateRateBps: true,
  reversedAmount: true,
  affiliateAmount: true,
  status: true,
  approvedAt: true,
  cancelledAt: true,
  cancelReason: true,
  expiresAt: true,
  expiredAt: true,
  paidAt: true,
  payoutId: true,
  costFinalizationFailedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type AffiliateCommissionRow = {
  id: string;
  partnerId: string;
  referralCode: string;
  conversionEventId: string;
  platformCommissionRefId: string;
  platformCommissionAmount: { toNumber(): number };
  attributableCostAmount: { toNumber(): number };
  profitBaseAmount: { toNumber(): number };
  affiliateRateBps: number;
  reversedAmount: { toNumber(): number };
  affiliateAmount: { toNumber(): number };
  status: string;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  expiresAt: Date;
  expiredAt: Date | null;
  paidAt: Date | null;
  payoutId: string | null;
  costFinalizationFailedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: AffiliateCommissionRow): AffiliateCommissionRecord {
  return {
    id: row.id,
    partnerId: row.partnerId,
    referralCode: row.referralCode,
    conversionEventId: row.conversionEventId,
    platformCommissionRefId: row.platformCommissionRefId,
    platformCommissionAmount: row.platformCommissionAmount.toNumber(),
    attributableCostAmount: row.attributableCostAmount.toNumber(),
    profitBaseAmount: row.profitBaseAmount.toNumber(),
    affiliateRateBps: row.affiliateRateBps,
    reversedAmount: row.reversedAmount.toNumber(),
    affiliateAmount: row.affiliateAmount.toNumber(),
    status: row.status as AffiliateCommissionStatusValue,
    approvedAt: row.approvedAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    expiresAt: row.expiresAt,
    expiredAt: row.expiredAt,
    paidAt: row.paidAt,
    payoutId: row.payoutId,
    costFinalizationFailedAt: row.costFinalizationFailedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaAffiliateCommissionRepository implements AffiliateCommissionRepository {
  async create(data: CreateAffiliateCommissionData): Promise<AffiliateCommissionRecord> {
    const row = await prisma.affiliateCommission.create({
      data: {
        partnerId: data.partnerId,
        referralCode: data.referralCode,
        conversionEventId: data.conversionEventId,
        platformCommissionRefId: data.platformCommissionRefId,
        platformCommissionAmount: data.platformCommissionAmount,
        attributableCostAmount: data.attributableCostAmount,
        profitBaseAmount: data.profitBaseAmount,
        affiliateRateBps: data.affiliateRateBps,
        affiliateAmount: data.affiliateAmount,
        expiresAt: data.expiresAt,
      },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<AffiliateCommissionRecord | null> {
    const row = await prisma.affiliateCommission.findUnique({
      where: { id },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findByConversionEventId(
    conversionEventId: string,
  ): Promise<AffiliateCommissionRecord | null> {
    const row = await prisma.affiliateCommission.findUnique({
      where: { conversionEventId },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findByPlatformCommissionRefId(
    platformCommissionRefId: string,
  ): Promise<AffiliateCommissionRecord | null> {
    const row = await prisma.affiliateCommission.findFirst({
      where: { platformCommissionRefId },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async listForPartner(
    partnerId: string,
    filter?: { status?: AffiliateCommissionStatusValue },
  ): Promise<AffiliateCommissionRecord[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: { partnerId, status: filter?.status },
      orderBy: { createdAt: "desc" },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return rows.map(toRecord);
  }

  async listExpirable(asOf: Date): Promise<AffiliateCommissionRecord[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: { status: "PENDING", expiresAt: { lte: asOf } },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return rows.map(toRecord);
  }

  async listApprovedForPartner(partnerId: string): Promise<AffiliateCommissionRecord[]> {
    const rows = await prisma.affiliateCommission.findMany({
      // Module 96 Financial Fix Pass — payoutId: null excludes any
      // commission already claimed by an in-flight payout (see this
      // method's own interface doc comment). Module 96 Financial
      // Integrity Hardening Pass — costFinalizationFailedAt: null
      // excludes any commission whose Stripe fee never arrived within
      // the bounded finalization window (Risk 3): its cost is not
      // resolved, so it must not be allowed into a payout batch until a
      // human clears the flag.
      where: { partnerId, status: "APPROVED", payoutId: null, costFinalizationFailedAt: null },
      orderBy: { createdAt: "asc" },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return rows.map(toRecord);
  }

  async listPendingFeeReconciliation(limit: number): Promise<AffiliateCommissionRecord[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        attributableCostAmount: 0,
        costFinalizationFailedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return rows.map(toRecord);
  }

  async listFeeFinalizationOverdue(
    cutoff: Date,
    limit: number,
  ): Promise<AffiliateCommissionRecord[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        attributableCostAmount: 0,
        costFinalizationFailedAt: null,
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return rows.map(toRecord);
  }

  async markCostFinalizationFailed(id: string, at: Date): Promise<AffiliateCommissionRecord> {
    const row = await prisma.affiliateCommission.update({
      where: { id },
      data: { costFinalizationFailedAt: at },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return toRecord(row);
  }

  async releaseClaimedCommissions(payoutId: string): Promise<void> {
    await prisma.affiliateCommission.updateMany({
      where: { payoutId, status: "APPROVED" },
      data: { payoutId: null },
    });
  }

  async updateStatus(
    id: string,
    data: {
      status: AffiliateCommissionStatusValue;
      approvedAt?: Date | null;
      cancelledAt?: Date | null;
      cancelReason?: string | null;
      expiredAt?: Date | null;
      paidAt?: Date | null;
      payoutId?: string | null;
    },
  ): Promise<AffiliateCommissionRecord> {
    const row = await prisma.affiliateCommission.update({
      where: { id },
      data: {
        status: data.status,
        approvedAt: data.approvedAt,
        cancelledAt: data.cancelledAt,
        cancelReason: data.cancelReason,
        expiredAt: data.expiredAt,
        paidAt: data.paidAt,
        payoutId: data.payoutId,
      },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return toRecord(row);
  }

  async recordReversal(
    id: string,
    data: { reversedAmount: number; status?: AffiliateCommissionStatusValue },
  ): Promise<AffiliateCommissionRecord> {
    const row = await prisma.affiliateCommission.update({
      where: { id },
      data: {
        reversedAmount: data.reversedAmount,
        ...(data.status ? { status: data.status } : {}),
      },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return toRecord(row);
  }

  /**
   * Module 96 Financial Integrity Hardening Pass — atomic replacement for
   * the read-then-write `recordReversal` race (see the domain interface's
   * own doc comment for the full rationale). Runs entirely inside one
   * `prisma.$transaction`:
   *  1. Fast-path idempotency check on `financialAdjustmentId` — no lock
   *     taken at all if this adjustment was already recorded.
   *  2. `SELECT ... FOR UPDATE` on the target commission row — serializes
   *     every concurrent reversal/correction attempt against THIS row
   *     (refund, dispute, fee-correction, or a redelivered duplicate of
   *     any of those all funnel through this same method).
   *  3. `decide()` is invoked with the freshly-locked row's current
   *     amounts — never a pre-lock read — to compute the amount to apply.
   *  4. Insert the append-only reversal row.
   *  5. Recompute `reversedAmount` as `SUM(amount)` over every reversal
   *     row for this commission (never an application-side increment),
   *     so the persisted total is always exactly the ledger's sum.
   *  6. Derive FULL/PARTIAL and the PAID-stays-PAID / REVERSED transition
   *     from that fresh sum and write both in the same statement.
   *
   * ## Why step 1's fast-path check does NOT, by itself, fully prevent a
   * ## duplicate `financialAdjustmentId` insert under real concurrency
   * Step 1's `findUnique` is a plain, unlocked read against the
   * `AffiliateCommissionReversal` table — step 2's `FOR UPDATE` only ever
   * locks the `AffiliateCommission` row, never anything on the reversal
   * ledger. Two concurrent calls for the exact same `financialAdjustmentId`
   * (a duplicate/redelivered event) can therefore BOTH pass step 1 (both
   * see "no existing reversal yet") before either has taken the lock in
   * step 2. From there, ONE of them acquires the lock, proceeds through
   * steps 3-6, and commits (which also releases the lock). The OTHER was
   * blocked waiting for that same lock in step 2; once it unblocks, it
   * proceeds directly into steps 3-6 itself — WITHOUT re-running step 1's
   * check — and its own step 4 insert collides with the row the winner
   * already committed, surfacing as Postgres/Prisma P2002 on the
   * `financialAdjustmentId` unique constraint. A real concurrent run of
   * exactly this scenario (`Promise.all` of two reconciliation calls for
   * the same commission/adjustment) reproduced this.
   *
   * The `financialAdjustmentId` unique constraint is the actual, final
   * source of truth for this idempotency guarantee (step 1 is only a
   * fast-path optimization to skip the lock/insert entirely in the
   * COMMON, non-racing case) — so the fix is the same "attempt the write,
   * and on P2002 for this exact key, converge on the winner's row"
   * pattern already used elsewhere in this codebase (`PrismaPaymentRepository.create`,
   * `PrismaAffiliateCommissionReversalRepository.create`,
   * `PrismaReconciliationScheduleCursorRepository.getOrCreate`) — see the
   * try/catch wrapping the `$transaction` call below.
   *
   * That catch MUST live OUTSIDE the `$transaction` callback, never
   * inside it: once Postgres raises the unique-constraint error inside
   * an open transaction, that transaction is aborted and no further
   * statement can run on it (Postgres would reject any further query
   * with "current transaction is aborted" until it's rolled back) — so
   * catching P2002 inside `tx`'s callback and then trying to keep using
   * `tx` to re-read would itself fail. Letting the error propagate out of
   * `$transaction` lets Prisma roll the failed transaction back cleanly;
   * the re-read below then runs as a brand-new, separate query. By the
   * time this transaction's own `create()` call could even be reached
   * (it only runs after successfully acquiring the row lock in step 2,
   * which only happens once the WINNING transaction has already
   * committed and released it), the winner's entire aggregate
   * `reversedAmount` recompute (step 5) has already committed too — so a
   * plain re-read of the commission row here is already fully up to
   * date, with no recomputation of any kind needed on this losing path.
   */
  async applyReversalAtomically(
    affiliateCommissionId: string,
    financialAdjustmentId: string,
    decide: (current: {
      affiliateAmount: number;
      reversedAmount: number;
      status: AffiliateCommissionStatusValue;
    }) => { amount: number; reason: string | null } | null,
  ): Promise<AffiliateCommissionRecord | null> {
    try {
      return await prisma.$transaction(async (tx) => {
        const existingReversal = await tx.affiliateCommissionReversal.findUnique({
          where: { financialAdjustmentId },
        });
        if (existingReversal) {
          const row = await tx.affiliateCommission.findUnique({
            where: { id: existingReversal.affiliateCommissionId },
            select: AFFILIATE_COMMISSION_SELECT,
          });
          return row ? toRecord(row) : null;
        }

        // Row-level lock — every concurrent caller for this SAME commission
        // (whatever its financialAdjustmentId) blocks here until the
        // holder of the lock commits, which is what makes the SUM()
        // recomputed below always see every reversal already committed
        // against this row, regardless of arrival order.
        //
        // Table name is the raw, `@@map`-ped physical name
        // ("affiliate_commissions" — see AffiliateCommission's `@@map` in
        // prisma/schema.prisma), NOT the Prisma model name
        // ("AffiliateCommission"). $queryRaw bypasses Prisma's own
        // model-to-table mapping entirely, so a raw query must always
        // reference the physical name directly — using the model name here
        // previously produced Postgres error 42P01 ("relation
        // \"AffiliateCommission\" does not exist"), since quoted Postgres
        // identifiers are matched exactly and case-sensitively, and no
        // table by that exact quoted name exists. Column names below are
        // NOT similarly mapped (no per-field `@map` on this model), so
        // their camelCase quoted identifiers are correct as-is.
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            affiliateAmount: unknown;
            reversedAmount: unknown;
            status: AffiliateCommissionStatusValue;
          }>
        >`SELECT id, "affiliateAmount", "reversedAmount", "status" FROM "affiliate_commissions" WHERE id = ${affiliateCommissionId}::uuid FOR UPDATE`;
        const current = locked[0];
        if (!current) {
          return null;
        }

        const currentAffiliateAmount = Number(current.affiliateAmount);
        const currentReversedAmount = Number(current.reversedAmount);

        const decision = decide({
          affiliateAmount: currentAffiliateAmount,
          reversedAmount: currentReversedAmount,
          status: current.status,
        });
        if (!decision || decision.amount <= 0) {
          const row = await tx.affiliateCommission.findUnique({
            where: { id: affiliateCommissionId },
            select: AFFILIATE_COMMISSION_SELECT,
          });
          return row ? toRecord(row) : null;
        }

        const remainingBeforeThisReversal = Math.max(
          0,
          currentAffiliateAmount - currentReversedAmount,
        );
        const type: "FULL" | "PARTIAL" =
          decision.amount >= remainingBeforeThisReversal ? "FULL" : "PARTIAL";

        await tx.affiliateCommissionReversal.create({
          data: {
            affiliateCommissionId,
            amount: decision.amount,
            type,
            financialAdjustmentId,
            reason: decision.reason,
          },
        });

        const sum = await tx.affiliateCommissionReversal.aggregate({
          where: { affiliateCommissionId },
          _sum: { amount: true },
        });
        const newReversedAmount = Math.min(
          currentAffiliateAmount,
          sum._sum.amount?.toNumber() ?? 0,
        );
        const nextStatus: AffiliateCommissionStatusValue | undefined =
          current.status === "PAID"
            ? undefined
            : newReversedAmount >= currentAffiliateAmount
              ? "REVERSED"
              : undefined;

        const row = await tx.affiliateCommission.update({
          where: { id: affiliateCommissionId },
          data: {
            reversedAmount: newReversedAmount,
            ...(nextStatus ? { status: nextStatus } : {}),
          },
          select: AFFILIATE_COMMISSION_SELECT,
        });
        return toRecord(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Lost the race described in this method's own doc comment above
        // — re-read as a fresh, separate query (never via the now-aborted
        // `tx`). The winning transaction's reversal insert AND its
        // aggregate `reversedAmount` recompute have already fully
        // committed by this point (see doc comment), so this commission
        // read is already correct with no further computation needed.
        const existingReversal = await prisma.affiliateCommissionReversal.findUnique({
          where: { financialAdjustmentId },
        });
        if (existingReversal) {
          const row = await prisma.affiliateCommission.findUnique({
            where: { id: existingReversal.affiliateCommissionId },
            select: AFFILIATE_COMMISSION_SELECT,
          });
          if (row) return toRecord(row);
        }
      }
      throw error;
    }
  }

  async markPaidByIds(ids: string[], payoutId: string, paidAt: Date): Promise<void> {
    if (ids.length === 0) return;
    await prisma.affiliateCommission.updateMany({
      where: { id: { in: ids } },
      data: { status: "PAID", payoutId, paidAt },
    });
  }

  async markPaidByPayoutId(payoutId: string, paidAt: Date): Promise<void> {
    await prisma.affiliateCommission.updateMany({
      where: { payoutId, status: "APPROVED" },
      data: { status: "PAID", paidAt },
    });
  }

  async totalsForPartner(partnerId: string): Promise<AffiliateEarningsTotals> {
    const [pending, approved, paid] = await Promise.all([
      prisma.affiliateCommission.aggregate({
        where: { partnerId, status: "PENDING" },
        _sum: { affiliateAmount: true },
      }),
      prisma.affiliateCommission.aggregate({
        where: { partnerId, status: "APPROVED" },
        _sum: { affiliateAmount: true },
      }),
      prisma.affiliateCommission.aggregate({
        where: { partnerId, status: "PAID" },
        _sum: { affiliateAmount: true },
      }),
    ]);
    return {
      pendingTotal: pending._sum.affiliateAmount?.toNumber() ?? 0,
      approvedTotal: approved._sum.affiliateAmount?.toNumber() ?? 0,
      paidTotal: paid._sum.affiliateAmount?.toNumber() ?? 0,
    };
  }
}
