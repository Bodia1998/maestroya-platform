import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";

/**
 * Module 65 — Trust & Integrity System: repository interface for
 * `TrustProfile` and its append-only event log (the `ScoreEvent` table,
 * shared by both Trust Score and Risk Score changes via its `scoreType`
 * discriminator). Follows the same "narrow, module-scoped, record-shaped
 * interface" convention as `PartnerFraudFlagRepository`/
 * `NotificationRepository` — pure business rules live in
 * `trust-score-policy.ts`/`risk-score-policy.ts`, this file only defines
 * the shape data is read/written in.
 *
 * `updateTrustScore`/`updateRiskScore` and
 * `listTrustScoreEvents`/`listRiskScoreEvents` stay as four distinct
 * methods here (this interface is this module's public API, unchanged by
 * the `ScoreEvent` merge below it) even though the Prisma implementation
 * behind them now shares a single table/private helper — see
 * `PrismaTrustProfileRepository.recordScoreEvent`/`listScoreEvents`.
 */

export interface TrustProfileRecord {
  id: string;
  userId: string;
  trustScore: number;
  riskScore: number;
  lastRecalculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScoreEventRecord {
  id: string;
  trustProfileId: string;
  reason: TrustRiskEventReasonValue;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
  detail: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
}

export interface RecordScoreEventData {
  reason: TrustRiskEventReasonValue;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
  detail: string;
  referenceType?: string | null;
  referenceId?: string | null;
}

export interface TrustProfileRepository {
  /** Returns the existing profile, or lazily creates one at the default
   *  scores (`DEFAULT_TRUST_SCORE`/`DEFAULT_RISK_SCORE`) if this is the
   *  user's first-ever Module 65 interaction — see
   *  `RecordUserBehaviorSignalUseCase`'s own doc comment for why this is
   *  the only place a `TrustProfile` is ever created. */
  findOrCreateByUserId(userId: string): Promise<TrustProfileRecord>;

  findByUserId(userId: string): Promise<TrustProfileRecord | null>;

  /** Persists the new trustScore/riskScore/lastRecalculatedAt and appends
   *  one row to the corresponding event table, atomically. */
  updateTrustScore(trustProfileId: string, newScore: number, event: RecordScoreEventData): Promise<TrustProfileRecord>;
  updateRiskScore(trustProfileId: string, newScore: number, event: RecordScoreEventData): Promise<TrustProfileRecord>;

  listTrustScoreEvents(trustProfileId: string, limit?: number): Promise<ScoreEventRecord[]>;
  listRiskScoreEvents(trustProfileId: string, limit?: number): Promise<ScoreEventRecord[]>;

  /** Users whose current riskScore is at or above `minRiskScore` — feeds
   *  the report generator's "Risk Engine Validation" section and any
   *  future admin risk-queue view. */
  countByRiskScoreAtLeast(minRiskScore: number): Promise<number>;
  countByTrustScoreAtMost(maxTrustScore: number): Promise<number>;
  countAll(): Promise<number>;
}
