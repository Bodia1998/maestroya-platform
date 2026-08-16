import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  ClaimExternalWebhookEventInput,
  ClaimExternalWebhookEventResult,
  ExternalEventProcessingStatus,
  ExternalWebhookEventRecord,
  ExternalWebhookEventRepository,
} from "@/domain/repositories/external-webhook-event-repository";

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objective C):
 * Prisma implementation of the provider-independent external-event
 * idempotency ledger — see `ExternalWebhookEventRepository`'s own doc
 * comment for the full concurrency/retry design this class implements.
 *
 * ## Why raw SQL, not `prisma.externalWebhookEvent.*`
 * `prisma generate` requires fetching the platform-specific Prisma
 * schema/query-engine binary from `binaries.prisma.sh`, which is
 * unreachable (403 Forbidden) in every sandbox this module was developed
 * and verified in — the exact same, already-documented constraint Module
 * 69's own implementation report records for `prisma validate`/`prisma
 * migrate status`. Prisma's generated `PrismaClient` type therefore could
 * not be regenerated to include the new `ExternalWebhookEvent` model this
 * module's migration adds (see prisma/migrations/
 * 20260901000000_add_external_webhook_event_idempotency/migration.sql),
 * so this repository is written against `prisma.$queryRaw`/`$executeRaw`
 * — a documented, precedented pattern already used elsewhere in this
 * codebase (see `PrismaPlatformAnalyticsRepository`'s own raw-query
 * methods) rather than the typed model delegate. Every value below is a
 * bound parameter (Prisma's tagged-template `$queryRaw`/`$executeRaw`),
 * never string-concatenated — no SQL-injection surface despite the raw
 * query. Once `prisma generate` can run against this schema in a real
 * deployment (see Module 70.1's own implementation report, Verification
 * section), this class can be trivially rewritten against
 * `prisma.externalWebhookEvent.*` with identical behavior — the migration
 * and table shape do not change either way.
 *
 * ## Concurrency
 * `claim()` always attempts the `INSERT` first. Postgres's own unique
 * index on `(provider, "externalEventId")` is what makes two concurrent
 * `claim()` calls for the same event safe: only one `INSERT` can ever
 * succeed, and the loser observes the unique-violation error (SQLSTATE
 * 23505) rather than a stale "not found" read — there is no
 * check-then-insert race window here at all, since there is no
 * application-level check preceding the insert.
 */

interface Row {
  id: string;
  provider: string;
  externalEventId: string;
  eventType: string | null;
  status: ExternalEventProcessingStatus;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: Row): ExternalWebhookEventRecord {
  return {
    id: row.id,
    provider: row.provider,
    externalEventId: row.externalEventId,
    eventType: row.eventType,
    status: row.status,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Postgres's unique-violation SQLSTATE — see
 *  https://www.postgresql.org/docs/current/errcodes-appendix.html. Raw
 *  queries surface the underlying driver error rather than Prisma's typed
 *  `P2002`, so this class matches on the SQLSTATE embedded in the thrown
 *  error's message the same way `$queryRaw`'s own documented error shape
 *  requires — see this class's own doc comment for why raw SQL is used at
 *  all here. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /23505|unique constraint/i.test(error.message);
}

export class PrismaExternalWebhookEventRepository implements ExternalWebhookEventRepository {
  async claim(input: ClaimExternalWebhookEventInput): Promise<ClaimExternalWebhookEventResult> {
    try {
      const rows = await prisma.$queryRaw<Row[]>`
        INSERT INTO "external_webhook_events" ("id", "provider", "externalEventId", "eventType", "status", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${input.provider}, ${input.externalEventId}, ${input.eventType ?? null}, 'PROCESSING', now(), now())
        RETURNING "id", "provider", "externalEventId", "eventType", "status", "processedAt", "createdAt", "updatedAt"
      `;
      const row = rows[0];
      if (!row) throw new Error("Insert into external_webhook_events returned no row.");
      return { claimed: true, record: toRecord(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // Another delivery already owns/completed this event. If its last
      // known status is FAILED, this delivery (the provider's own retry)
      // may reclaim it — an UPDATE guarded by the expected prior status,
      // the same optimistic-concurrency shape every other status
      // transition in this codebase uses (see e.g.
      // PrismaDisputeResolutionDecisionRepository.transition). If two
      // retries race this UPDATE concurrently, only one row-affecting
      // UPDATE can win; Postgres serializes the two statements and the
      // loser's `UPDATE ... WHERE status = 'FAILED'` simply matches zero
      // rows.
      const reclaimed = await prisma.$queryRaw<Row[]>`
        UPDATE "external_webhook_events"
        SET "status" = 'PROCESSING', "eventType" = COALESCE(${input.eventType ?? null}, "eventType"), "updatedAt" = now()
        WHERE "provider" = ${input.provider} AND "externalEventId" = ${input.externalEventId} AND "status" = 'FAILED'
        RETURNING "id", "provider", "externalEventId", "eventType", "status", "processedAt", "createdAt", "updatedAt"
      `;
      const reclaimedRow = reclaimed[0];
      if (reclaimedRow) {
        return { claimed: true, record: toRecord(reclaimedRow) };
      }

      const existing = await prisma.$queryRaw<Row[]>`
        SELECT "id", "provider", "externalEventId", "eventType", "status", "processedAt", "createdAt", "updatedAt"
        FROM "external_webhook_events"
        WHERE "provider" = ${input.provider} AND "externalEventId" = ${input.externalEventId}
      `;
      const existingRow = existing[0];
      if (!existingRow) {
        // Extremely narrow race: the FAILED row we just lost the reclaim
        // race for was deleted between the two queries above. This table
        // has no delete path anywhere in this codebase — defensive only.
        throw new Error("external_webhook_events: unique violation but no row found on re-read.");
      }
      return { claimed: false, record: toRecord(existingRow) };
    }
  }

  async markProcessed(id: string): Promise<ExternalWebhookEventRecord> {
    const rows = await prisma.$queryRaw<Row[]>`
      UPDATE "external_webhook_events"
      SET "status" = 'PROCESSED', "processedAt" = now(), "updatedAt" = now()
      WHERE "id" = ${id}::uuid
      RETURNING "id", "provider", "externalEventId", "eventType", "status", "processedAt", "createdAt", "updatedAt"
    `;
    const row = rows[0];
    if (!row) throw new Error(`external_webhook_events: no row with id "${id}".`);
    return toRecord(row);
  }

  async markFailed(id: string): Promise<ExternalWebhookEventRecord> {
    const rows = await prisma.$queryRaw<Row[]>`
      UPDATE "external_webhook_events"
      SET "status" = 'FAILED', "updatedAt" = now()
      WHERE "id" = ${id}::uuid
      RETURNING "id", "provider", "externalEventId", "eventType", "status", "processedAt", "createdAt", "updatedAt"
    `;
    const row = rows[0];
    if (!row) throw new Error(`external_webhook_events: no row with id "${id}".`);
    return toRecord(row);
  }
}
