import type { EventBus } from "@/application/ports/event-bus";
import type { TrustProfileRepository } from "@/domain/repositories/trust-profile-repository";
import { recalculateTrustScore, type TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";
import { recalculateRiskScore } from "@/domain/services/risk-score-policy";
import { TrustScoreChanged } from "@/domain/events/trust-score-changed";
import { RiskScoreChanged } from "@/domain/events/risk-score-changed";

/**
 * Module 65 — Trust & Integrity System: the single entry point every
 * detector (`DetectOffPlatformCommunicationUseCase`,
 * `DetectFraudSignalsUseCase`, ...) and every positive-signal producer
 * (a future `JobCompleted`/`ReviewSubmitted` subscriber) calls to move a
 * user's Trust and Risk Score. Centralizing the recalculation here — never
 * letting a detector touch `TrustProfileRepository` directly — is what
 * guarantees every score change is (a) computed by
 * `trust-score-policy.ts`/`risk-score-policy.ts`, never an ad hoc number,
 * and (b) always paired with an audit-trail event write and a domain
 * event, with no call site able to skip either step.
 */
export interface RecordUserBehaviorSignalInput {
  userId: string;
  reason: TrustRiskEventReasonValue;
  detail: string;
  referenceType?: string;
  referenceId?: string;
  /** Only ever supplied for `ADMIN_ADJUSTMENT` — see
   *  `trust-score-policy.ts`'s own doc comment on why every other reason
   *  has a fixed default delta. */
  trustDeltaOverride?: number;
  riskDeltaOverride?: number;
}

export interface RecordUserBehaviorSignalResult {
  trustScoreBefore: number;
  trustScoreAfter: number;
  riskScoreBefore: number;
  riskScoreAfter: number;
}

export class RecordUserBehaviorSignalUseCase {
  constructor(
    private readonly trustProfiles: TrustProfileRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: RecordUserBehaviorSignalInput): Promise<RecordUserBehaviorSignalResult> {
    const profile = await this.trustProfiles.findOrCreateByUserId(input.userId);

    const trust = recalculateTrustScore(profile.trustScore, input.reason, input.trustDeltaOverride);
    const risk = recalculateRiskScore(profile.riskScore, input.reason, input.riskDeltaOverride);

    let latest = profile;
    if (trust.delta !== 0) {
      latest = await this.trustProfiles.updateTrustScore(profile.id, trust.scoreAfter, {
        reason: input.reason,
        delta: trust.delta,
        scoreBefore: trust.scoreBefore,
        scoreAfter: trust.scoreAfter,
        detail: input.detail,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
      });
      await this.eventBus.publish(new TrustScoreChanged(input.userId, input.reason, trust.scoreBefore, trust.scoreAfter));
    }

    if (risk.delta !== 0) {
      latest = await this.trustProfiles.updateRiskScore(latest.id, risk.scoreAfter, {
        reason: input.reason,
        delta: risk.delta,
        scoreBefore: risk.scoreBefore,
        scoreAfter: risk.scoreAfter,
        detail: input.detail,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
      });
      await this.eventBus.publish(new RiskScoreChanged(input.userId, input.reason, risk.scoreBefore, risk.scoreAfter));
    }

    return {
      trustScoreBefore: trust.scoreBefore,
      trustScoreAfter: latest.trustScore,
      riskScoreBefore: risk.scoreBefore,
      riskScoreAfter: latest.riskScore,
    };
  }
}
