import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { FraudDetected } from "@/domain/events/fraud-detected";
import { detectSpamActivity, type SpamActivityInput } from "@/domain/services/spam-detection-rules";

/** Module 65 — Trust & Integrity System: requirement #10. */
export class DetectSpamActivityUseCase {
  constructor(
    private readonly fraudSignals: FraudSignalRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: SpamActivityInput): Promise<number> {
    const findings = detectSpamActivity(input);
    for (const finding of findings) {
      const signal = await this.fraudSignals.create({ userId: finding.userId, type: "SPAM_ACTIVITY", detail: finding.detail });
      await this.eventBus.publish(new FraudDetected(finding.userId, signal.id, "SPAM_ACTIVITY", []));
      await this.recordBehaviorSignal.execute({
        userId: finding.userId,
        reason: "SPAM_ACTIVITY_DETECTED",
        detail: finding.detail,
        referenceType: "FraudSignal",
        referenceId: signal.id,
      });
    }
    return findings.length;
  }
}
