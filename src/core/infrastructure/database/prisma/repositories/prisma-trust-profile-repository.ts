import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  TrustProfileRepository,
  TrustProfileRecord,
  ScoreEventRecord,
  RecordScoreEventData,
} from "@/domain/repositories/trust-profile-repository";
import { DEFAULT_TRUST_SCORE } from "@/domain/services/trust-score-policy";
import { DEFAULT_RISK_SCORE } from "@/domain/services/risk-score-policy";
import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";

/**
 * Module 65 — Trust & Integrity System: Prisma implementation of
 * `TrustProfileRepository`, backed by `trust_profiles` and its single
 * append-only `score_events` table (shared by Trust Score and Risk Score
 * events via `ScoreEvent.scoreType`).
 */
const PROFILE_SELECT = {
  id: true,
  userId: true,
  trustScore: true,
  riskScore: true,
  lastRecalculatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toProfileRecord(row: {
  id: string;
  userId: string;
  trustScore: number;
  riskScore: number;
  lastRecalculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): TrustProfileRecord {
  return { ...row };
}

function toEventRecord(row: {
  id: string;
  trustProfileId: string;
  reason: string;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
  detail: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
}): ScoreEventRecord {
  return { ...row, reason: row.reason as TrustRiskEventReasonValue };
}

export class PrismaTrustProfileRepository implements TrustProfileRepository {
  async findOrCreateByUserId(userId: string): Promise<TrustProfileRecord> {
    const existing = await prisma.trustProfile.findUnique({ where: { userId }, select: PROFILE_SELECT });
    if (existing) return toProfileRecord(existing);

    const created = await prisma.trustProfile.create({
      data: { userId, trustScore: DEFAULT_TRUST_SCORE, riskScore: DEFAULT_RISK_SCORE },
      select: PROFILE_SELECT,
    });
    return toProfileRecord(created);
  }

  async findByUserId(userId: string): Promise<TrustProfileRecord | null> {
    const row = await prisma.trustProfile.findUnique({ where: { userId }, select: PROFILE_SELECT });
    return row ? toProfileRecord(row) : null;
  }

  async updateTrustScore(trustProfileId: string, newScore: number, event: RecordScoreEventData): Promise<TrustProfileRecord> {
    return this.recordScoreEvent(trustProfileId, "TRUST", "trustScore", newScore, event);
  }

  async updateRiskScore(trustProfileId: string, newScore: number, event: RecordScoreEventData): Promise<TrustProfileRecord> {
    return this.recordScoreEvent(trustProfileId, "RISK", "riskScore", newScore, event);
  }

  async listTrustScoreEvents(trustProfileId: string, limit = 50): Promise<ScoreEventRecord[]> {
    return this.listScoreEvents(trustProfileId, "TRUST", limit);
  }

  async listRiskScoreEvents(trustProfileId: string, limit = 50): Promise<ScoreEventRecord[]> {
    return this.listScoreEvents(trustProfileId, "RISK", limit);
  }

  /**
   * Shared implementation behind `updateTrustScore`/`updateRiskScore` —
   * those two methods stay on the public `TrustProfileRepository`
   * interface (mirroring the model's two independent, named scores), but
   * both now write to the single `score_events` table via `ScoreEvent`'s
   * `scoreType` discriminator instead of two copy-pasted transactions
   * against two separate tables. `scoreColumn` picks which TrustProfile
   * column this call updates.
   */
  private async recordScoreEvent(
    trustProfileId: string,
    scoreType: "TRUST" | "RISK",
    scoreColumn: "trustScore" | "riskScore",
    newScore: number,
    event: RecordScoreEventData,
  ): Promise<TrustProfileRecord> {
    const profileUpdateData =
      scoreColumn === "trustScore"
        ? { trustScore: newScore, lastRecalculatedAt: new Date() }
        : { riskScore: newScore, lastRecalculatedAt: new Date() };

    const [, updated] = await prisma.$transaction([
      prisma.scoreEvent.create({
        data: {
          trustProfileId,
          scoreType,
          reason: event.reason,
          delta: event.delta,
          scoreBefore: event.scoreBefore,
          scoreAfter: event.scoreAfter,
          detail: event.detail,
          referenceType: event.referenceType ?? null,
          referenceId: event.referenceId ?? null,
        },
      }),
      prisma.trustProfile.update({
        where: { id: trustProfileId },
        data: profileUpdateData,
        select: PROFILE_SELECT,
      }),
    ]);
    return toProfileRecord(updated);
  }

  /** Shared implementation behind `listTrustScoreEvents`/`listRiskScoreEvents`. */
  private async listScoreEvents(trustProfileId: string, scoreType: "TRUST" | "RISK", limit: number): Promise<ScoreEventRecord[]> {
    const rows = await prisma.scoreEvent.findMany({
      where: { trustProfileId, scoreType },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toEventRecord);
  }

  async countByRiskScoreAtLeast(minRiskScore: number): Promise<number> {
    return prisma.trustProfile.count({ where: { riskScore: { gte: minRiskScore } } });
  }

  async countByTrustScoreAtMost(maxTrustScore: number): Promise<number> {
    return prisma.trustProfile.count({ where: { trustScore: { lte: maxTrustScore } } });
  }

  async countAll(): Promise<number> {
    return prisma.trustProfile.count();
  }
}
