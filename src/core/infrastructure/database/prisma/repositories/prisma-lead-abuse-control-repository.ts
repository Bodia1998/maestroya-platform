import { Prisma, type LeadAbuseDecision } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import {
  buildLeadAbuseAuditEntry,
  type AdminLeadAbuseBlockDraft,
  type AutomatedLeadAbuseDecisionDraft,
  type LeadAbuseControlRepository,
  type LeadAbuseDecisionOutcome,
  type LeadAbuseDecisionRecord,
  type LeadAbuseFactsReader,
  type LeadAbuseSignalDraft,
} from "@/domain/repositories/lead-abuse-control-repository";
import type { LeadAbuseEventSignalType, LeadAbuseRestrictedAction, LeadAbuseRuleKey } from "@/domain/services/lead-abuse-controls";
import { recordAdminAuditLogWithin } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export function toLeadAbuseDecisionRecord(row: LeadAbuseDecision): LeadAbuseDecisionRecord {
  return {
    id: row.id,
    subjectUserId: row.subjectUserId,
    action: row.action,
    restrictedAction: row.restrictedAction,
    status: row.status,
    origin: row.origin,
    ruleKey: row.ruleKey as LeadAbuseRuleKey | null,
    ruleVersion: row.ruleVersion,
    reasonCode: row.reasonCode,
    createdByUserId: row.createdByUserId,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    explanation: row.explanation,
    liftedAt: row.liftedAt,
    liftedByUserId: row.liftedByUserId,
    resolutionNote: row.resolutionNote,
  };
}

const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Module 156 — Prisma adapter of `lead_abuse_signals` / `lead_abuse_decisions`. Only `createMany(skipDuplicates)`, `create`, reads
 * and status-conditional `updateMany` are used: no delete, no upsert, no update of any identity / decision column (the database
 * triggers forbid it as well).
 *
 * Idempotency and races:
 *  - a signal is inserted with `ON CONFLICT DO NOTHING` on the UNIQUE dedupeKey (`skipDuplicates`), so duplicate or concurrent
 *    recording yields exactly one row;
 *  - a decision is created inside ONE interactive transaction together with its audit entry. If the partial unique index rejects
 *    it (an ACTIVE decision of that kind exists — created by a concurrent writer or earlier), the transaction rolls back and the
 *    winner is returned with `created: false`; only the creating caller wrote an audit entry;
 *  - an ACTIVE block whose expiry has passed is first moved to EXPIRED so it cannot shadow a new one;
 *  - `lift` locks the row (`FOR UPDATE`) so exactly one of several racing lifts succeeds, and writes its audit entry atomically.
 */
export class PrismaLeadAbuseControlRepository implements LeadAbuseControlRepository {
  async recordSignal(draft: LeadAbuseSignalDraft): Promise<boolean> {
    const result = await prisma.leadAbuseSignal.createMany({
      data: [
        {
          subjectUserId: draft.subjectUserId,
          signalType: draft.signalType,
          reliability: draft.reliability,
          severity: draft.severity,
          ruleVersion: draft.ruleVersion,
          dedupeKey: draft.dedupeKey,
          targetLeadId: draft.targetLeadId,
          observedCount: draft.observedCount,
          threshold: draft.threshold,
          windowSeconds: draft.windowSeconds,
          occurredAt: draft.occurredAt,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async findBlockInForce(subjectUserId: string, action: LeadAbuseRestrictedAction, now: Date): Promise<LeadAbuseDecisionRecord | null> {
    const row = await prisma.leadAbuseDecision.findFirst({
      where: { subjectUserId, action: "TEMPORARY_BLOCK", restrictedAction: action, status: "ACTIVE", expiresAt: { gt: now } },
      orderBy: { decidedAt: "desc" },
    });
    return row ? toLeadAbuseDecisionRecord(row) : null;
  }

  async findDecisionById(id: string): Promise<LeadAbuseDecisionRecord | null> {
    const row = await prisma.leadAbuseDecision.findUnique({ where: { id } });
    return row ? toLeadAbuseDecisionRecord(row) : null;
  }

  async listActiveForSubject(subjectUserId: string, now: Date): Promise<LeadAbuseDecisionRecord[]> {
    const rows = await prisma.leadAbuseDecision.findMany({
      where: { subjectUserId, status: "ACTIVE", OR: [{ action: "FLAG_FOR_REVIEW" }, { action: "TEMPORARY_BLOCK", expiresAt: { gt: now } }] },
      orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toLeadAbuseDecisionRecord);
  }

  async listOpenFlags(limit: number): Promise<LeadAbuseDecisionRecord[]> {
    const rows = await prisma.leadAbuseDecision.findMany({
      where: { status: "ACTIVE", action: "FLAG_FOR_REVIEW" },
      orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(toLeadAbuseDecisionRecord);
  }

  async applyAutomatedDecision(draft: AutomatedLeadAbuseDecisionDraft): Promise<LeadAbuseDecisionOutcome> {
    return this.createOrFindActive(
      { subjectUserId: draft.subjectUserId, action: draft.action, restrictedAction: draft.restrictedAction, decidedAt: draft.decidedAt },
      async (tx) => {
        const row = await tx.leadAbuseDecision.create({
          data: {
            subjectUserId: draft.subjectUserId,
            action: draft.action,
            restrictedAction: draft.restrictedAction,
            status: "ACTIVE",
            origin: "AUTOMATED",
            ruleKey: draft.ruleKey,
            ruleVersion: draft.ruleVersion,
            reasonCode: draft.ruleKey,
            createdByUserId: null,
            decidedAt: draft.decidedAt,
            expiresAt: draft.expiresAt,
          },
        });
        await recordAdminAuditLogWithin(
          tx,
          buildLeadAbuseAuditEntry(draft.action === "FLAG_FOR_REVIEW" ? "LEAD_ABUSE_FLAGGED" : "LEAD_ABUSE_BLOCK_APPLIED", null, toLeadAbuseDecisionRecord(row), null),
        );
        return row;
      },
    );
  }

  async imposeAdminBlock(draft: AdminLeadAbuseBlockDraft): Promise<LeadAbuseDecisionOutcome> {
    return this.createOrFindActive(
      { subjectUserId: draft.subjectUserId, action: "TEMPORARY_BLOCK", restrictedAction: draft.restrictedAction, decidedAt: draft.decidedAt },
      async (tx) => {
        const row = await tx.leadAbuseDecision.create({
          data: {
            subjectUserId: draft.subjectUserId,
            action: "TEMPORARY_BLOCK",
            restrictedAction: draft.restrictedAction,
            status: "ACTIVE",
            origin: "ADMIN",
            ruleKey: null,
            ruleVersion: null,
            reasonCode: "ADMIN_BLOCK",
            createdByUserId: draft.actorUserId,
            decidedAt: draft.decidedAt,
            expiresAt: draft.expiresAt,
            explanation: draft.explanation,
          },
        });
        await recordAdminAuditLogWithin(tx, buildLeadAbuseAuditEntry("LEAD_ABUSE_BLOCK_APPLIED", draft.actorUserId, toLeadAbuseDecisionRecord(row), null));
        return row;
      },
    );
  }

  async lift(id: string, actorUserId: string, note: string, at: Date): Promise<LeadAbuseDecisionRecord | null> {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "lead_abuse_decisions" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (locked[0]?.status !== "ACTIVE") return null;
      const result = await tx.leadAbuseDecision.updateMany({
        where: { id, status: "ACTIVE" },
        data: { status: "LIFTED", liftedAt: at, liftedByUserId: actorUserId, resolutionNote: note },
      });
      if (result.count === 0) return null;
      const row = await tx.leadAbuseDecision.findUniqueOrThrow({ where: { id } });
      await recordAdminAuditLogWithin(tx, buildLeadAbuseAuditEntry("LEAD_ABUSE_DECISION_LIFTED", actorUserId, toLeadAbuseDecisionRecord(row), "ACTIVE"));
      return toLeadAbuseDecisionRecord(row);
    });
  }

  /**
   * Runs `create` in a transaction. A unique violation means an ACTIVE decision of the same kind exists: it is returned instead.
   * (The catch is OUTSIDE the transaction: a failed statement aborts a PostgreSQL transaction, so nothing may run after it inside.)
   * Expired blocks are moved to EXPIRED first, and the whole attempt is repeated once if the winner vanished in between.
   */
  private async createOrFindActive(
    kind: { subjectUserId: string; action: "FLAG_FOR_REVIEW" | "TEMPORARY_BLOCK"; restrictedAction: LeadAbuseRestrictedAction | null; decidedAt: Date },
    create: (tx: Tx) => Promise<LeadAbuseDecision>,
  ): Promise<LeadAbuseDecisionOutcome> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const row = await prisma.$transaction(async (tx) => {
          if (kind.action === "TEMPORARY_BLOCK") {
            await tx.leadAbuseDecision.updateMany({
              where: { subjectUserId: kind.subjectUserId, action: "TEMPORARY_BLOCK", restrictedAction: kind.restrictedAction, status: "ACTIVE", expiresAt: { lte: kind.decidedAt } },
              data: { status: "EXPIRED" },
            });
          }
          return create(tx);
        });
        return { decision: toLeadAbuseDecisionRecord(row), created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await prisma.leadAbuseDecision.findFirst({
          where: { subjectUserId: kind.subjectUserId, action: kind.action, restrictedAction: kind.restrictedAction, status: "ACTIVE" },
          orderBy: { decidedAt: "desc" },
        });
        if (existing) return { decision: toLeadAbuseDecisionRecord(existing), created: false };
      }
    }
    throw new Error("Could not create or find the lead abuse decision.");
  }
}

const n = (rows: { c: bigint | number }[]): number => Number(rows[0]?.c ?? 0);

/**
 * Module 156 — READ-ONLY counting adapter. Every statement is a plain SELECT; it never locks, writes or returns a row of any
 * purchase, dispute, revocation, lead or request — only a number. Subjects are USER ids and are joined to their profile server
 * side. Near-duplicate detection is an on-the-fly md5 of the whitespace/case-normalised title + description; the digest is never
 * stored and no content leaves the database.
 *
 * TIMESTAMPS. The native Prisma engine binds a JS `Date` in a raw query as `timestamptz`, while every column compared here is
 * `timestamp(3)` holding UTC (Prisma's contract). Comparing the two makes PostgreSQL convert the COLUMN using the SESSION time zone,
 * so on a database whose time zone is not UTC (e.g. Europe/Madrid, +2 h) the last hour of rows looks two hours older than it is and
 * every short-window count silently returns 0. Each `since` is therefore passed as an ISO-8601 string and converted explicitly:
 * `(<iso>::timestamptz AT TIME ZONE 'UTC')` is a UTC `timestamp`, whatever the session time zone or the Prisma engine.
 */
export class PrismaLeadAbuseFactsReader implements LeadAbuseFactsReader {
  /** Injectable only so a test can run the counts inside a transaction with `SET LOCAL TIME ZONE`; production uses the shared client. */
  constructor(private readonly db: Pick<typeof prisma, "$queryRaw"> = prisma) {}

  async countPublicationsByCustomer(userId: string, since: Date): Promise<number> {
    return n(await this.db.$queryRaw<{ c: bigint }[]>`
      SELECT count(*) AS "c"
      FROM "leads" l
      JOIN "service_requests" sr ON sr."id" = l."serviceRequestId"
      JOIN "customer_profiles" cp ON cp."id" = sr."customerId"
      WHERE cp."userId" = ${userId}::uuid AND sr."flowVersion" = 'LEAD_V1' AND l."publishedAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
  }

  async maxIdenticalRequestGroupByCustomer(userId: string, since: Date): Promise<number> {
    return n(await this.db.$queryRaw<{ c: bigint }[]>`
      SELECT COALESCE(MAX(g."k"), 0) AS "c" FROM (
        SELECT count(*) AS "k"
        FROM "service_requests" sr
        JOIN "customer_profiles" cp ON cp."id" = sr."customerId"
        WHERE cp."userId" = ${userId}::uuid AND sr."flowVersion" = 'LEAD_V1' AND sr."deletedAt" IS NULL AND sr."createdAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        GROUP BY md5(lower(regexp_replace(btrim(sr."title" || ' ' || sr."description"), '\\s+', ' ', 'g')))
      ) g`);
  }

  async countPurchaseInitiationsByProfessional(userId: string, since: Date): Promise<number> {
    return n(await this.db.$queryRaw<{ c: bigint }[]>`
      SELECT count(*) AS "c"
      FROM "lead_purchases" lp
      JOIN "professional_profiles" pp ON pp."id" = lp."professionalProfileId"
      WHERE pp."userId" = ${userId}::uuid AND lp."createdAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
  }

  async countDistinctEventLeads(userId: string, type: LeadAbuseEventSignalType, since: Date): Promise<number> {
    return n(await this.db.$queryRaw<{ c: bigint }[]>`
      SELECT count(DISTINCT s."targetLeadId") AS "c"
      FROM "lead_abuse_signals" s
      WHERE s."subjectUserId" = ${userId}::uuid AND s."signalType" = ${type}::"LeadAbuseSignalType" AND s."occurredAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
  }

  async countDisputesOpenedByProfessional(userId: string, since: Date): Promise<number> {
    return this.countDisputeFact("DISPUTE_OPENED", userId, since);
  }

  async countDisputesLostByProfessional(userId: string, since: Date): Promise<number> {
    return this.countDisputeFact("DISPUTE_LOST", userId, since);
  }

  async countRevocationsByProfessional(userId: string, since: Date): Promise<number> {
    return this.countDisputeFact("REVOCATION", userId, since);
  }

  /** Read-only: the M155 tables are reached only through the SELECT-only view created by the M156 fact-view migration. */
  private async countDisputeFact(kind: "DISPUTE_OPENED" | "DISPUTE_LOST" | "REVOCATION", userId: string, since: Date): Promise<number> {
    return n(await this.db.$queryRaw<{ c: bigint }[]>`
      SELECT count(*) AS "c"
      FROM "lead_abuse_professional_dispute_facts" f
      WHERE f."kind" = ${kind} AND f."professionalUserId" = ${userId}::uuid AND f."occurredAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
  }
}
