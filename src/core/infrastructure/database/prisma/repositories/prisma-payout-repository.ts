import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreatePendingPayoutData,
  MarkPayoutFailedInput,
  MarkPayoutPaidInput,
  PayoutRecord,
  PayoutRepository,
  PayoutStatusValue,
  UpdatePayoutResult,
} from "@/domain/repositories/payout-repository";

/**
 * Module 76 — Professional Payout Execution.
 *
 * `PayoutRepository` implementation over the existing `payouts` table —
 * the first writer of this table (see that interface's own doc comment).
 *
 * ## Why raw SQL, not `prisma.payout.*`
 * Same documented constraint `PrismaExternalWebhookEventRepository`
 * already records on itself: `prisma generate` needs to fetch a
 * platform-specific query-engine binary from `binaries.prisma.sh`, which
 * returns `403 Forbidden` in this sandbox (verified directly — same
 * failure regardless of schema content, a pure network/environment
 * restriction, not something this module's own schema change could ever
 * cause or fix), so the generated `PrismaClient` type here cannot be
 * regenerated to know about the columns this module's migration adds
 * (`prisma/migrations/20260904000000_add_professional_payout_execution/
 * migration.sql`: `jobId`, `paymentId`, `idempotencyKey`, `attemptCount`,
 * `lastAttemptedAt`). This repository is therefore written against
 * `prisma.$queryRaw`/`$executeRaw` — every value bound as a tagged-
 * template parameter, never string-concatenated, so there is no
 * SQL-injection surface despite the raw query, exactly like that sibling
 * repository. Once `prisma generate` can run against this schema in a
 * real deployment, this class can be trivially rewritten against
 * `prisma.payout.*` with identical behavior — the migration and table
 * shape do not change either way.
 *
 * ## Concurrency
 * `createPending` always attempts the `INSERT` first, relying on
 * `payouts.jobId`'s own unique index (not an application-level
 * check-then-insert) to guarantee only one row can ever exist per Job —
 * see `PayoutRepository.createPending`'s own doc comment.
 * `markPaid`/`markFailed` are both a single `UPDATE ... WHERE id = :id
 * AND status = ANY(:fromStatuses)`, the same "fold the compare-and-swap
 * guard into the write itself" shape `PrismaPaymentRepository.updateStatus`
 * already uses (there written against the typed client, here against raw
 * SQL for the reason above — the concurrency guarantee is identical
 * either way, since a plain `UPDATE ... WHERE` is exactly what the typed
 * `updateMany` compiles down to).
 */

const SELECT_COLUMNS = `
  "id", "jobId", "paymentId", "professionalProfileId", "companyProfileId",
  "amount", "currency", "status", "stripeTransferId", "idempotencyKey",
  "failureReason", "attemptCount", "lastAttemptedAt", "processedAt",
  "createdAt", "updatedAt"
`;

interface Row {
  id: string;
  jobId: string | null;
  paymentId: string | null;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  amount: unknown;
  currency: string;
  status: string;
  stripeTransferId: string | null;
  idempotencyKey: string | null;
  failureReason: string | null;
  attemptCount: number;
  lastAttemptedAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: Row): PayoutRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    paymentId: row.paymentId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status as PayoutStatusValue,
    stripeTransferId: row.stripeTransferId,
    idempotencyKey: row.idempotencyKey,
    failureReason: row.failureReason,
    attemptCount: row.attemptCount,
    lastAttemptedAt: row.lastAttemptedAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaPayoutRepository implements PayoutRepository {
  async findById(id: string): Promise<PayoutRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "payouts" WHERE "id" = $1::uuid`,
      id,
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async findByJobId(jobId: string): Promise<PayoutRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "payouts" WHERE "jobId" = $1::uuid`,
      jobId,
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async createPending(data: CreatePendingPayoutData): Promise<PayoutRecord> {
    const inserted = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO "payouts" (
         "id", "jobId", "paymentId", "professionalProfileId", "companyProfileId",
         "amount", "currency", "status", "idempotencyKey", "attemptCount",
         "createdAt", "updatedAt"
       )
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'PENDING', $7, 0, now(), now())
       ON CONFLICT ("jobId") DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      data.jobId,
      data.paymentId,
      data.professionalProfileId,
      data.companyProfileId,
      data.amount,
      data.currency,
      data.idempotencyKey,
    );

    const insertedRow = inserted[0];
    if (insertedRow) {
      return toRecord(insertedRow);
    }

    // Lost the race: another caller's INSERT already won. Return that
    // existing row rather than throwing — see this method's own doc
    // comment (mirrors `PrismaExternalWebhookEventRepository.claim`'s own
    // "insert first, re-read on conflict" convention).
    const existing = await this.findByJobId(data.jobId);
    if (!existing) {
      throw new Error(`payouts: unique violation on jobId "${data.jobId}" but no row found on re-read.`);
    }
    return existing;
  }

  async markPaid(input: MarkPayoutPaidInput): Promise<UpdatePayoutResult> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE "payouts"
       SET "status" = 'PAID', "stripeTransferId" = $2, "processedAt" = now(),
           "lastAttemptedAt" = now(), "failureReason" = NULL, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($3::"PayoutStatus"[])
       RETURNING ${SELECT_COLUMNS}`,
      input.id,
      input.stripeTransferId,
      [...input.fromStatuses],
    );

    const applied = rows.length > 0;
    const record = applied ? toRecord(rows[0]!) : await this.findById(input.id);
    if (!record) {
      throw new Error(`Payout ${input.id} disappeared during markPaid — this should never happen.`);
    }
    return { applied, record };
  }

  async markFailed(input: MarkPayoutFailedInput): Promise<UpdatePayoutResult> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE "payouts"
       SET "status" = 'FAILED', "failureReason" = $2, "lastAttemptedAt" = now(),
           "attemptCount" = "attemptCount" + 1, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($3::"PayoutStatus"[])
       RETURNING ${SELECT_COLUMNS}`,
      input.id,
      input.failureReason,
      [...input.fromStatuses],
    );

    const applied = rows.length > 0;
    const record = applied ? toRecord(rows[0]!) : await this.findById(input.id);
    if (!record) {
      throw new Error(`Payout ${input.id} disappeared during markFailed — this should never happen.`);
    }
    return { applied, record };
  }
}
