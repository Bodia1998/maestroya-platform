import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { FraudDetected } from "@/domain/events/fraud-detected";
import {
  detectReviewerBurst,
  detectReviewsWithoutTransaction,
  detectReviewRing,
  type ReviewerActivityInput,
  type ReviewRingCandidate,
} from "@/domain/services/fake-review-detection-rules";

/** Module 65 — Trust & Integrity System: requirement #9. Same
 *  "caller-gathered candidates in, FraudSignal + behavior signal out"
 *  shape as `DetectFraudSignalsUseCase`. */
export interface DetectFakeReviewPatternsInput {
  reviewerActivity?: ReviewerActivityInput[];
  reviewRingCandidates?: ReviewRingCandidate[];
}

export class DetectFakeReviewPatternsUseCase {
  constructor(
    private readonly fraudSignals: FraudSignalRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: DetectFakeReviewPatternsInput): Promise<number> {
    const findings = [
      ...(input.reviewerActivity ?? []).flatMap((a) => [detectReviewerBurst(a), detectReviewsWithoutTransaction(a)]),
      ...(input.reviewRingCandidates ?? []).map(detectReviewRing),
    ].filter((f): f is NonNullable<typeof f> => f !== null);

    for (const finding of findings) {
      const primaryUserId = finding.involvedUserIds[0];
      if (!primaryUserId) continue;
      const relatedUserIds = finding.involvedUserIds.slice(1);
      const signal = await this.fraudSignals.create({
        userId: primaryUserId,
        type: "FAKE_REVIEW_PATTERN",
        detail: finding.detail,
        relatedUserIds,
      });
      await this.eventBus.publish(new FraudDetected(primaryUserId, signal.id, "FAKE_REVIEW_PATTERN", relatedUserIds));
      for (const userId of finding.involvedUserIds) {
        await this.recordBehaviorSignal.execute({
          userId,
          reason: "FAKE_REVIEW_PATTERN_DETECTED",
          detail: finding.detail,
          referenceType: "FraudSignal",
          referenceId: signal.id,
        });
      }
    }

    return findings.length;
  }
}
