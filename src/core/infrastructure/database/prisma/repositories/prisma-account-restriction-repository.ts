import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AccountRestrictionRecord,
  AccountRestrictionRepository,
  AccountRestrictionReason,
  AccountRestrictionState,
  CreateAccountRestrictionData,
  ListAccountRestrictionsOptions,
} from "@/domain/repositories/account-restriction-repository";
import { mostSevereActiveRestriction } from "@/domain/services/account-restriction-rules";

const SELECT = {
  id: true,
  userId: true,
  state: true,
  reason: true,
  notes: true,
  createdByUserId: true,
  expiresAt: true,
  liftedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  userId: string;
  state: string;
  reason: string;
  notes: string | null;
  createdByUserId: string | null;
  expiresAt: Date | null;
  liftedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): AccountRestrictionRecord {
  return {
    id: row.id,
    userId: row.userId,
    state: row.state as AccountRestrictionState,
    reason: row.reason as AccountRestrictionReason,
    notes: row.notes,
    createdByUserId: row.createdByUserId,
    expiresAt: row.expiresAt,
    liftedAt: row.liftedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Security & Anti-Abuse module (Module 24): Prisma implementation of
 * AccountRestrictionRepository, backed by the new `AccountRestriction`
 * model.
 */
export class PrismaAccountRestrictionRepository implements AccountRestrictionRepository {
  async create(data: CreateAccountRestrictionData): Promise<AccountRestrictionRecord> {
    if (data.expiresAt === null && !data.createdByUserId) {
      // Structural enforcement of "no permanent auto-bans" (see this
      // interface's own doc comment) — the automated AntiAbuseService path
      // never calls this without an expiresAt, but this repository (the
      // one place both paths converge before hitting the DB) re-asserts
      // it rather than trusting every future caller to remember.
      throw new Error(
        "AccountRestriction with expiresAt=null requires an explicit createdByUserId (admin decision).",
      );
    }

    const row = await prisma.accountRestriction.create({
      data: {
        userId: data.userId,
        state: data.state,
        reason: data.reason,
        notes: data.notes ?? null,
        createdByUserId: data.createdByUserId ?? null,
        expiresAt: data.expiresAt,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async findActiveForUser(userId: string, now: Date): Promise<AccountRestrictionRecord | null> {
    const rows = await prisma.accountRestriction.findMany({
      where: {
        userId,
        liftedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: SELECT,
    });
    return mostSevereActiveRestriction(rows.map(toRecord), now);
  }

  async lift(id: string, now: Date): Promise<AccountRestrictionRecord | null> {
    const existing = await prisma.accountRestriction.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;

    const row = await prisma.accountRestriction.update({
      where: { id },
      data: { liftedAt: now },
      select: SELECT,
    });
    return toRecord(row);
  }

  async list(options: ListAccountRestrictionsOptions): Promise<AccountRestrictionRecord[]> {
    const rows = await prisma.accountRestriction.findMany({
      where: { userId: options.userId },
      select: SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }
}
