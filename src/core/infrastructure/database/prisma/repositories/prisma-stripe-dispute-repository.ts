import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  MarkStripeDisputeClosedInput,
  StripeDisputeRecord,
  StripeDisputeRepository,
  StripeDisputeStatusValue,
  UpsertStripeDisputeData,
} from "@/domain/repositories/stripe-dispute-repository";

/**
 * Module 86 — Stripe Chargeback & Dispute Handling.
 *
 * `StripeDisputeRepository` implementation over the new `stripe_disputes`
 * table (`prisma/migrations/20260909000000_add_stripe_dispute_tracking/`).
 *
 * ## Why raw SQL, not `prisma.stripeDispute.*`
 * Same documented, verified constraint every other post-Module-70.1
 * repository in this codebase records on itself (see
 * `PrismaPayoutRepository`'s own doc comment): `prisma generate` needs a
 * platform-specific query-engine binary from `binaries.prisma.sh`, which
 * returns `403 Forbidden` in this sandbox — a pure network/environment
 * restriction, re-confirmed directly while building this module, not
 * something this migration's own schema content could ever cause or fix.
 * The generated `PrismaClient` type therefore has no `stripeDispute`
 * model. Every value is bound as a tagged-template parameter via
 * `$queryRawUnsafe`, never string-concatenated — no SQL-injection surface
 * despite the raw query. Once `prisma generate` can run against this
 * schema in a real deployment, this class can be trivially rewritten
 * against `prisma.stripeDispute.*` with identical behavior.
 */

const SELECT_COLUMNS = `
  "id", "stripeDisputeId", "stripeChargeId", "stripePaymentIntentId",
  "paymentId", "jobId", "amount", "currency", "reason", "status",
  "evidenceDueBy", "financialAdjustmentId", "closedAt", "createdAt", "updatedAt"
`;

interface Row {
  id: string;
  stripeDisputeId: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  paymentId: string | null;
  jobId: string | null;
  amount: unknown;
  currency: string;
  reason: string | null;
  status: string;
  evidenceDueBy: Date | null;
  financialAdjustmentId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: Row): StripeDisputeRecord {
  return {
    id: row.id,
    stripeDisputeId: row.stripeDisputeId,
    stripeChargeId: row.stripeChargeId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    paymentId: row.paymentId,
    jobId: row.jobId,
    amount: Number(row.amount),
    currency: row.currency,
    reason: row.reason,
    status: row.status as StripeDisputeStatusValue,
    evidenceDueBy: row.evidenceDueBy,
    financialAdjustmentId: row.financialAdjustmentId,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const TERMINAL_STATUSES: readonly StripeDisputeStatusValue[] = ["WON", "LOST", "WARNING_CLOSED"];

export class PrismaStripeDisputeRepository implements StripeDisputeRepository {
  async findByStripeDisputeId(stripeDisputeId: string): Promise<StripeDisputeRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "stripe_disputes" WHERE "stripeDisputeId" = $1`,
      stripeDisputeId,
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<StripeDisputeRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "stripe_disputes" WHERE "id" = $1::uuid`,
      id,
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async createIfNotExists(data: UpsertStripeDisputeData): Promise<{ created: boolean; record: StripeDisputeRecord }> {
    const inserted = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO "stripe_disputes" (
         "id", "stripeDisputeId", "stripeChargeId", "stripePaymentIntentId",
         "paymentId", "jobId", "amount", "currency", "reason", "status",
         "evidenceDueBy", "createdAt", "updatedAt"
       )
       VALUES (gen_random_uuid(), $1, $2, $3, $4::uuid, $5::uuid, $6, $7, $8, $9::"StripeDisputeStatus", $10, now(), now())
       ON CONFLICT ("stripeDisputeId") DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      data.stripeDisputeId,
      data.stripeChargeId,
      data.stripePaymentIntentId,
      data.paymentId,
      data.jobId,
      data.amount,
      data.currency,
      data.reason,
      data.status,
      data.evidenceDueBy,
    );

    const insertedRow = inserted[0];
    if (insertedRow) {
      return { created: true, record: toRecord(insertedRow) };
    }

    // Lost the race (or a genuine redelivery of `charge.dispute.created`):
    // another caller's INSERT already won — return that existing row
    // rather than throwing, mirroring `PrismaPayoutRepository.createPending`'s
    // own "insert first, re-read on conflict" convention.
    const existing = await this.findByStripeDisputeId(data.stripeDisputeId);
    if (!existing) {
      throw new Error(`stripe_disputes: unique violation on stripeDisputeId "${data.stripeDisputeId}" but no row found on re-read.`);
    }
    return { created: false, record: existing };
  }

  async updateFromStripe(
    id: string,
    data: Pick<UpsertStripeDisputeData, "amount" | "reason" | "status" | "evidenceDueBy">,
  ): Promise<StripeDisputeRecord> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE "stripe_disputes"
       SET "amount" = $2, "reason" = $3, "status" = $4::"StripeDisputeStatus",
           "evidenceDueBy" = $5, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" != ALL($6::"StripeDisputeStatus"[])
       RETURNING ${SELECT_COLUMNS}`,
      id,
      data.amount,
      data.reason,
      data.status,
      data.evidenceDueBy,
      [...TERMINAL_STATUSES],
    );

    const row = rows[0];
    if (row) return toRecord(row);

    // Either the row doesn't exist, or it's already terminal — see this
    // method's own doc comment ("never resurrect a closed dispute back to
    // a non-terminal status"). Re-read and return whatever is current.
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`StripeDispute ${id} disappeared during updateFromStripe — this should never happen.`);
    }
    return existing;
  }

  async markClosed(input: MarkStripeDisputeClosedInput): Promise<StripeDisputeRecord> {
    const existing = await this.findById(input.id);
    if (!existing) {
      throw new Error(`StripeDispute ${input.id} not found in markClosed.`);
    }
    if (TERMINAL_STATUSES.includes(existing.status)) {
      // Idempotent replay — a duplicate `charge.dispute.closed` delivery
      // (including one carrying a distinct Stripe event id). Never
      // re-runs a financial side effect a second time; the caller
      // (`ProcessStripeDisputeWebhookUseCase.handleClosed`) checks this
      // return value's own `financialAdjustmentId` before deciding
      // whether anything further needs to happen.
      return existing;
    }

    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE "stripe_disputes"
       SET "status" = $2::"StripeDisputeStatus", "financialAdjustmentId" = $3::uuid,
           "closedAt" = now(), "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" != ALL($4::"StripeDisputeStatus"[])
       RETURNING ${SELECT_COLUMNS}`,
      input.id,
      input.status,
      input.financialAdjustmentId,
      [...TERMINAL_STATUSES],
    );

    const row = rows[0];
    if (row) return toRecord(row);

    // Lost a race against a concurrent close — re-read and return the
    // winner's already-closed row.
    const fresh = await this.findById(input.id);
    if (!fresh) {
      throw new Error(`StripeDispute ${input.id} disappeared during markClosed — this should never happen.`);
    }
    return fresh;
  }
}
