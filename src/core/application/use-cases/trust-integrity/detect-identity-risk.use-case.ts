import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { FraudDetected } from "@/domain/events/fraud-detected";
import { detectIdentityRisk, type IdentityVerificationSummary } from "@/domain/services/identity-risk-rules";

/**
 * Module 65 — Trust & Integrity System: requirement #14 — reuses Module
 * 59's `ProfessionalVerificationRepository` output (summarized by the
 * caller into `IdentityVerificationSummary`) rather than duplicating any
 * verification logic — see `identity-risk-rules.ts`'s own doc comment.
 */
export class DetectIdentityRiskUseCase {
  constructor(
    private readonly fraudSignals: FraudSignalRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(summary: IdentityVerificationSummary): Promise<boolean> {
    const finding = detectIdentityRisk(summary);
    if (!finding) return false;

    const signal = await this.fraudSignals.create({
      userId: finding.userId,
      type: "SUSPICIOUS_REGISTRATION_PATTERN",
      detail: finding.detail,
    });
    await this.eventBus.publish(new FraudDetected(finding.userId, signal.id, "SUSPICIOUS_REGISTRATION_PATTERN", []));
    await this.recordBehaviorSignal.execute({
      userId: finding.userId,
      reason: "IDENTITY_RISK_DETECTED",
      detail: finding.detail,
      referenceType: "FraudSignal",
      referenceId: signal.id,
    });
    return true;
  }
}
