import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { FraudDetected } from "@/domain/events/fraud-detected";
import {
  detectSamePhoneClusters,
  detectSameIbanClusters,
  detectSameStripeAccountClusters,
  detectSameDeviceClusters,
  detectSuspiciousRegistrationPattern,
  detectRepeatedFailedVerification,
  type IdentifierCluster,
  type RegistrationPatternInput,
} from "@/domain/services/fraud-detection-rules";

/**
 * Module 65 — Trust & Integrity System: requirement #4. Orchestrates every
 * `fraud-detection-rules.ts` detector against caller-supplied candidate
 * data (this use case never queries a repository itself for the raw
 * clusters — the caller, e.g. a scheduled sweep or an onboarding-time
 * check, gathers phone/IBAN/Stripe-account/device clusters and registration
 * timing first), persists one `FraudSignal` per finding, and feeds every
 * implicated user's Risk Score via `RecordUserBehaviorSignalUseCase`.
 */
export interface DetectFraudSignalsInput {
  phoneClusters?: IdentifierCluster[];
  ibanClusters?: IdentifierCluster[];
  stripeAccountClusters?: IdentifierCluster[];
  deviceClusters?: IdentifierCluster[];
  registrationPatterns?: RegistrationPatternInput[];
  repeatedFailedVerifications?: { userId: string; rejectionCount: number }[];
}

export class DetectFraudSignalsUseCase {
  constructor(
    private readonly fraudSignals: FraudSignalRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: DetectFraudSignalsInput): Promise<number> {
    const findings = [
      ...detectSamePhoneClusters(input.phoneClusters ?? []),
      ...detectSameIbanClusters(input.ibanClusters ?? []),
      ...detectSameStripeAccountClusters(input.stripeAccountClusters ?? []),
      ...detectSameDeviceClusters(input.deviceClusters ?? []),
      ...(input.registrationPatterns ?? []).map(detectSuspiciousRegistrationPattern).filter((f) => f !== null),
      ...(input.repeatedFailedVerifications ?? [])
        .map((v) => detectRepeatedFailedVerification(v.userId, v.rejectionCount))
        .filter((f) => f !== null),
    ];

    for (const finding of findings) {
      const primaryUserId = finding.userIds[0];
      if (!primaryUserId) continue;
      const relatedUserIds = finding.userIds.slice(1);
      const signal = await this.fraudSignals.create({
        userId: primaryUserId,
        type: finding.type,
        detail: finding.detail,
        relatedUserIds,
      });
      await this.eventBus.publish(new FraudDetected(primaryUserId, signal.id, finding.type, relatedUserIds));

      for (const userId of finding.userIds) {
        await this.recordBehaviorSignal.execute({
          userId,
          reason: "FRAUD_SIGNAL_DETECTED",
          detail: finding.detail,
          referenceType: "FraudSignal",
          referenceId: signal.id,
        });
      }
    }

    return findings.length;
  }
}
