import type { TrustProfileRepository } from "@/domain/repositories/trust-profile-repository";
import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { OffPlatformDetectionRepository } from "@/domain/repositories/off-platform-detection-repository";
import type { TrustAutomatedActionRepository } from "@/domain/repositories/trust-automated-action-repository";
import type { ManualReviewCaseRepository } from "@/domain/repositories/manual-review-case-repository";
import type { TrustAppealRepository } from "@/domain/repositories/trust-appeal-repository";
import { RISK_SCORE_THRESHOLDS } from "@/domain/services/risk-score-policy";

/**
 * Module 65 — Trust & Integrity System: a small read-only rollup for
 * `npm run trust-report`, same "one-off statistics use case feeding a
 * report script" pattern as `GetMaterialsStatisticsUseCase` (Module 63).
 */
export interface TrustIntegrityStatistics {
  totalTrustProfiles: number;
  usersAtOrAboveWarningRisk: number;
  usersAtOrAboveSuspensionRisk: number;
  usersWithLowTrust: number;
  openFraudSignals: number;
  totalFraudSignals: number;
  offPlatformDetectionEventsTotal: number;
  activeAutomatedActions: number;
  totalAutomatedActions: number;
  openManualReviewCases: number;
  totalManualReviewCases: number;
  pendingAppeals: number;
  totalAppeals: number;
}

export class GetTrustIntegrityStatisticsUseCase {
  constructor(
    private readonly trustProfiles: TrustProfileRepository,
    private readonly fraudSignals: FraudSignalRepository,
    private readonly offPlatformDetection: OffPlatformDetectionRepository,
    private readonly automatedActions: TrustAutomatedActionRepository,
    private readonly manualReviewCases: ManualReviewCaseRepository,
    private readonly appeals: TrustAppealRepository,
  ) {}

  async execute(): Promise<TrustIntegrityStatistics> {
    const [
      totalTrustProfiles,
      usersAtOrAboveWarningRisk,
      usersAtOrAboveSuspensionRisk,
      usersWithLowTrust,
      openFraudSignals,
      totalFraudSignals,
      offPlatformDetectionEventsTotal,
      activeAutomatedActions,
      totalAutomatedActions,
      openManualReviewCases,
      totalManualReviewCases,
      pendingAppeals,
      totalAppeals,
    ] = await Promise.all([
      this.trustProfiles.countAll(),
      this.trustProfiles.countByRiskScoreAtLeast(RISK_SCORE_THRESHOLDS.WARNING),
      this.trustProfiles.countByRiskScoreAtLeast(RISK_SCORE_THRESHOLDS.SUSPENSION),
      this.trustProfiles.countByTrustScoreAtMost(30),
      this.fraudSignals.listOpen().then((rows) => rows.length),
      this.fraudSignals.countAll(),
      this.offPlatformDetection.countAll(),
      this.automatedActions.countActive(),
      this.automatedActions.countAll(),
      this.manualReviewCases.countByState("OPEN"),
      this.manualReviewCases.countAll(),
      this.appeals.countByState("SUBMITTED"),
      this.appeals.countAll(),
    ]);

    return {
      totalTrustProfiles,
      usersAtOrAboveWarningRisk,
      usersAtOrAboveSuspensionRisk,
      usersWithLowTrust,
      openFraudSignals,
      totalFraudSignals,
      offPlatformDetectionEventsTotal,
      activeAutomatedActions,
      totalAutomatedActions,
      openManualReviewCases,
      totalManualReviewCases,
      pendingAppeals,
      totalAppeals,
    };
  }
}
