import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreatePendingRefundData,
  MarkRefundFailedInput,
  MarkRefundProcessedInput,
  RefundRecord,
  RefundRepository,
  RefundStatusValue,
  UpdateRefundResult,
} from "@/domain/repositories/refund-repository";

/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * `RefundRepository` implementation over the existing `refunds` table —
 * the first writer of this table (see that interface's own doc comment).
 *
 * ## Why raw SQL, not `prisma.refund.*`
 * Same documented, verified-in-this-sandbox constraint
 * `PrismaPayoutRepository`/`PrismaExternalWebhookEventRepository` already
 * record on themselves: `prisma generate` cannot fetch a query-engine
 * binary from `binaries.prisma.sh` in this environment (403, a network/
 * environment restriction unrelated to this module's own schema change),
 * so the generated `PrismaClient` type cannot be regenerated to know
 * about the columns this module's migration adds (`financialAdjustmentId`,
 * `idempotencyKey`, `failureReason`, `attemptCount` — see
 * `prisma/migrations/20260905000000_add_refund_dispute_financial_execution/
 * migration.sql`). Written against `prisma.$queryRawUnsafe`/positional
 * parameters, every value bound as a parameter, never string-concatenated
 * — identical safety story to `PrismaPayoutRepository`. Once `prisma
 * generate` can run against this schema in a real deployment, this class
 * can be trivially rewritten against `prisma.refund.*` with identical
 * behavior.
 *
 * ## Concurrency
 * `createPending` always attempts the `INSERT` first, relying on
 * `refunds.financialAdjustmentId`'s own unique index (not an
 * application-level check-then-insert) to guarantee only one row can ever
 * exist per `FinancialAdjustment` — see `RefundRepository.createPending`'s
 * own doc comment. `markProcessed`/`markFailed` are both a single
 * `UPDATE ... WHERE id = :id AND status = ANY(:fromStatuses)`, the same
 * "fold the compare-and-swap guard into the write itself" shape
 * `PrismaPayoutRepository.markPaid`/`markFailed` already use.
 */

const SELECT_COLUMNS = `
  "id", "paymentId", "requestedByUserId", "amount", "status",
  "stripeRefundId", "processedAt", "notes", "financialAdjustmentId",
  "idempotencyKey", "failureReason", "attemptCount", "createdAt", "updatedAt"
`;

interface Row {
  id: string;
  paymentId: string;
  requestedByUserId: string;
  amount: unknown;
  status: string;
  stripeRefundId: string | null;
  processedAt: Date | null;
  notes: string | null;
  financialAdjustmentId: string | null;
  idempotencyKey: string | null;
  failureReason: string | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: Row): RefundRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    requestedByUserId: row.requestedByUserId,
    amount: Number(row.amount),
    status: row.status as RefundStatusValue,
    stripeRefundId: row.stripeRefundId,
    processedAt: row.processedAt,
    notes: row.notes,
    financialAdjustmentId: row.financialAdjustmentId,
    idempotencyKey: row.idempotencyKey,
    failureReason: row.failureReason,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaRefundRepository implements RefundRepository {
  async findById(id: string): Promise<RefundRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(`SELECT ${SELECT_COLUMNS} FROM "refunds" WHERE "id" = $1::uuid`, id);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async findByFinancialAdjustmentId(financialAdjustmentId: string): Promise<RefundRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "refunds" WHERE "financialAdjustmentId" = $1::uuid`,
      financialAdjustmentId,
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async findByStripeRefundId(stripeRefundId: string): Promise<RefundRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "refunds" WHERE "stripeRefundId" = $1`,
      stripeRefundId,
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async createPending(data: CreatePendingRefundData): Promise<RefundRecord> {
    const inserted = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO "refunds" (
         "id", "paymentId", "requestedByUserId", "amount", "reason", "status",
         "financialAdjustmentId", "idempotencyKey", "notes", "attemptCount",
         "createdAt", "updatedAt"
       )
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, 'OTHER', 'REQUESTED', $4::uuid, $5, $6, 0, now(), now())
       ON CONFLICT ("financialAdjustmentId") DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      data.paymentId,
      data.requestedByUserId,
      data.amount,
      data.financialAdjustmentId,
      data.idempotencyKey,
      data.notes,
    );

    const insertedRow = inserted[0];
    if (insertedRow) {
      return toRecord(insertedRow);
    }

    // Lost the race: another caller's INSERT already won — see this
    // method's own doc comment (mirrors
    // `PrismaPayoutRepository.createPending`'s own convention).
    const existing = await this.findByFinancialAdjustmentId(data.financialAdjustmentId);
    if (!existing) {
      throw new Error(
        `refunds: unique violation on financialAdjustmentId "${data.financialAdjustmentId}" but no row found on re-read.`,
      );
    }
    return existing;
  }

  async markProcessed(input: MarkRefundProcessedInput): Promise<UpdateRefundResult> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE "refunds"
       SET "status" = 'PROCESSED', "stripeRefundId" = $2, "processedAt" = now(),
           "failureReason" = NULL, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($3::"RefundStatus"[])
       RETURNING ${SELECT_COLUMNS}`,
      input.id,
      input.stripeRefundId,
      [...input.fromStatuses],
    );

    const applied = rows.length > 0;
    const record = applied ? toRecord(rows[0]!) : await this.findById(input.id);
    if (!record) {
      throw new Error(`Refund ${input.id} disappeared during markProcessed — this should never happen.`);
    }
    return { applied, record };
  }

  async markFailed(input: MarkRefundFailedInput): Promise<UpdateRefundResult> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE "refunds"
       SET "status" = 'FAILED', "failureReason" = $2, "attemptCount" = "attemptCount" + 1, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($3::"RefundStatus"[])
       RETURNING ${SELECT_COLUMNS}`,
      input.id,
      input.failureReason,
      [...input.fromStatuses],
    );

    const applied = rows.length > 0;
    const record = applied ? toRecord(rows[0]!) : await this.findById(input.id);
    if (!record) {
      throw new Error(`Refund ${input.id} disappeared during markFailed — this should never happen.`);
    }
    return { applied, record };
  }

  async listForPayment(paymentId: string): Promise<RefundRecord[]> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "refunds" WHERE "paymentId" = $1::uuid ORDER BY "createdAt" ASC`,
      paymentId,
    );
    return rows.map(toRecord);
  }
}
