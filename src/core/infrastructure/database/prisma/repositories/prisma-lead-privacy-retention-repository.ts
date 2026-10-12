import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  LeadPrivacyRetentionRepository,
  LeadPrivacySweepOptions,
  LeadRequestAnonymizationResult,
} from "@/domain/repositories/lead-privacy-repository";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import { LEAD_REQUEST_ERASED_TEXT, PURCHASE_STATUSES_BLOCKING_MINIMIZATION } from "@/domain/services/lead-privacy";
import { propagateServiceRequestStatusToLead } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";

/** Request statuses an erasure cancels. COMPLETED / EXPIRED / CANCELLED / DISPUTED keep their history untouched. */
const CANCELLABLE_REQUEST_STATUSES = ["DRAFT", "PUBLISHED", "QUOTED", "ACCEPTED", "IN_PROGRESS"] as const;

const MAX_LIMIT = 500;

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return 0;
  return Math.min(limit, MAX_LIMIT);
}

const NOTHING: LeadRequestAnonymizationResult = { eligible: 0, anonymized: 0, leadsCancelled: 0 };

/**
 * Module 158 — bounded, idempotent, concurrency-safe LEAD_V1 request-content privacy writes.
 *
 * What it writes: ONLY `service_requests` free text (title / description), the request's soft-delete stamp and — for an erased
 * customer — the cancellation of a still-open request (whose lead the existing central helper then cancels). What it never touches:
 * lead purchases, the fee ledger, invoices, credit notes, refunds, quality claims, fee disputes, revocations, abuse signals /
 * decisions, audit entries, request photo rows (their external files need their own purge — documented limitation), nor any legacy
 * quote / payment / commission / payout table.
 *
 * Concurrency: candidate rows are claimed `FOR UPDATE OF sr SKIP LOCKED` inside one transaction, and each UPDATE repeats the
 * qualifying predicate, so two concurrent runs never process the same row and a repeat finds nothing left to do.
 */
export class PrismaLeadPrivacyRetentionRepository implements LeadPrivacyRetentionRepository {
  async anonymizeRequestsOfErasedCustomers(
    options: LeadPrivacySweepOptions & { userId?: string },
  ): Promise<LeadRequestAnonymizationResult> {
    const limit = boundedLimit(options.limit);
    if (limit === 0) return NOTHING;
    const lock = options.dryRun ? Prisma.empty : Prisma.sql`FOR UPDATE OF sr SKIP LOCKED`;
    const onlyUser = options.userId ? Prisma.sql`AND u."id" = ${options.userId}::uuid` : Prisma.empty;

    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
        SELECT sr."id" AS "id", sr."status"::text AS "status"
          FROM "service_requests" sr
          JOIN "customer_profiles" cp ON cp."id" = sr."customerId"
          JOIN "users" u ON u."id" = cp."userId"
         WHERE sr."flowVersion" = ${LEAD_FLOW_VERSION}::"TransactionFlowVersion"
           AND u."personalDataErasedAt" IS NOT NULL
           ${onlyUser}
           AND (sr."title" <> ${LEAD_REQUEST_ERASED_TEXT}
                OR sr."description" <> ${LEAD_REQUEST_ERASED_TEXT}
                OR sr."deletedAt" IS NULL
                OR sr."status"::text IN (${Prisma.join([...CANCELLABLE_REQUEST_STATUSES])}))
         ORDER BY sr."createdAt" ASC, sr."id" ASC
         LIMIT ${limit}
         ${lock}`);

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return NOTHING;
      const cancellable = rows.filter((r) => (CANCELLABLE_REQUEST_STATUSES as readonly string[]).includes(r.status)).map((r) => r.id);

      if (options.dryRun) {
        const leadsCancelled = cancellable.length
          ? await tx.lead.count({ where: { serviceRequestId: { in: cancellable }, status: { in: ["DRAFT", "PUBLISHED"] } } })
          : 0;
        return { eligible: ids.length, anonymized: 0, leadsCancelled };
      }

      const now = new Date();
      await tx.serviceRequest.updateMany({
        where: { id: { in: ids } },
        data: { title: LEAD_REQUEST_ERASED_TEXT, description: LEAD_REQUEST_ERASED_TEXT },
      });
      await tx.serviceRequest.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: now } });

      let leadsCancelled = 0;
      if (cancellable.length > 0) {
        await tx.serviceRequest.updateMany({
          where: { id: { in: cancellable }, status: { in: [...CANCELLABLE_REQUEST_STATUSES] } },
          data: { status: "CANCELLED" },
        });
        // The one central propagation (Module 130): LEAD_V1-scoped and status-conditional; never touches purchases.
        for (const id of cancellable) leadsCancelled += await propagateServiceRequestStatusToLead(tx, id, "CANCELLED");
      }

      return { eligible: ids.length, anonymized: ids.length, leadsCancelled };
    });
  }

  async minimizeTerminalLeadRequestContent(
    options: LeadPrivacySweepOptions & { cutoff: Date | null },
  ): Promise<LeadRequestAnonymizationResult> {
    // No approved retention period -> nothing is ever eligible (fail safe).
    if (options.cutoff === null) return NOTHING;
    const limit = boundedLimit(options.limit);
    if (limit === 0) return NOTHING;
    const lock = options.dryRun ? Prisma.empty : Prisma.sql`FOR UPDATE OF sr SKIP LOCKED`;

    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT sr."id" AS "id"
          FROM "service_requests" sr
          JOIN "leads" l ON l."serviceRequestId" = sr."id"
         WHERE sr."flowVersion" = ${LEAD_FLOW_VERSION}::"TransactionFlowVersion"
           AND l."status"::text IN ('CLOSED', 'EXPIRED', 'CANCELLED')
           AND l."updatedAt" <= ${options.cutoff}
           AND (sr."title" <> ${LEAD_REQUEST_ERASED_TEXT} OR sr."description" <> ${LEAD_REQUEST_ERASED_TEXT})
           AND NOT EXISTS (
                 SELECT 1 FROM "lead_purchases" p
                  WHERE p."leadId" = l."id" AND p."status"::text IN (${Prisma.join([...PURCHASE_STATUSES_BLOCKING_MINIMIZATION])}))
         ORDER BY l."updatedAt" ASC, sr."id" ASC
         LIMIT ${limit}
         ${lock}`);

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return NOTHING;
      if (options.dryRun) return { eligible: ids.length, anonymized: 0, leadsCancelled: 0 };

      await tx.serviceRequest.updateMany({
        where: { id: { in: ids } },
        data: { title: LEAD_REQUEST_ERASED_TEXT, description: LEAD_REQUEST_ERASED_TEXT },
      });
      return { eligible: ids.length, anonymized: ids.length, leadsCancelled: 0 };
    });
  }

  async countOpenLeadsWithoutContactSharingRecord(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS "n"
        FROM "leads" l
       WHERE l."status"::text IN ('DRAFT', 'PUBLISHED')
         AND NOT EXISTS (SELECT 1 FROM "lead_contact_sharing_records" r WHERE r."leadId" = l."id")`);
    return Number(rows[0]?.n ?? 0n);
  }
}
