import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { FraudDetected } from "@/domain/events/fraud-detected";
import type { PricingBreakdown } from "@/domain/services/pricing-calculation-service";
import {
  detectPricingSplitAnomaly,
  detectExtremeQuoteModification,
  detectRepeatedPricingAnomalies,
} from "@/domain/services/suspicious-pricing-detection-rules";

/** Module 65 — Trust & Integrity System: requirement #11 — integrates
 *  with Module 64's `PricingBreakdown` rather than re-deriving pricing. */
export interface DetectSuspiciousPricingInput {
  professionalUserId: string;
  quoteId: string;
  breakdown: PricingBreakdown;
  previousTotal?: number;
  anomalyCountInWindow: number;
}

export class DetectSuspiciousPricingUseCase {
  constructor(
    private readonly fraudSignals: FraudSignalRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: DetectSuspiciousPricingInput): Promise<number> {
    const findings = [
      ...detectPricingSplitAnomaly(input.breakdown),
      ...(input.previousTotal !== undefined
        ? [detectExtremeQuoteModification(input.previousTotal, input.breakdown.total)]
        : []),
      detectRepeatedPricingAnomalies(input.professionalUserId, input.anomalyCountInWindow),
    ].filter((f): f is NonNullable<typeof f> => f !== null);

    for (const finding of findings) {
      const signal = await this.fraudSignals.create({
        userId: input.professionalUserId,
        type: "SUSPICIOUS_PRICING",
        detail: `Quote ${input.quoteId}: ${finding.detail}`,
      });
      await this.eventBus.publish(new FraudDetected(input.professionalUserId, signal.id, "SUSPICIOUS_PRICING", []));
      await this.recordBehaviorSignal.execute({
        userId: input.professionalUserId,
        reason: "SUSPICIOUS_PRICING_DETECTED",
        detail: finding.detail,
        referenceType: "FraudSignal",
        referenceId: signal.id,
      });
    }
    return findings.length;
  }
}
