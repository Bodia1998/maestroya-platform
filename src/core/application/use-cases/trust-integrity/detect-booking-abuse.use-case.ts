import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { FraudDetected } from "@/domain/events/fraud-detected";
import {
  detectExcessiveCancellations,
  detectGhostCustomer,
  detectGhostProfessional,
  detectFakeBookingPattern,
  type CancellationActivityInput,
  type GhostPartyInput,
  type FakeBookingPatternInput,
} from "@/domain/services/booking-abuse-detection-rules";

/** Module 65 — Trust & Integrity System: requirement #12. */
export interface DetectBookingAbuseInput {
  cancellationActivity?: CancellationActivityInput[];
  ghostCustomerActivity?: GhostPartyInput[];
  ghostProfessionalActivity?: GhostPartyInput[];
  fakeBookingPatterns?: FakeBookingPatternInput[];
}

export class DetectBookingAbuseUseCase {
  constructor(
    private readonly fraudSignals: FraudSignalRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: DetectBookingAbuseInput): Promise<number> {
    const findings = [
      ...(input.cancellationActivity ?? []).map(detectExcessiveCancellations),
      ...(input.ghostCustomerActivity ?? []).map(detectGhostCustomer),
      ...(input.ghostProfessionalActivity ?? []).map(detectGhostProfessional),
      ...(input.fakeBookingPatterns ?? []).map(detectFakeBookingPattern),
    ].filter((f): f is NonNullable<typeof f> => f !== null);

    for (const finding of findings) {
      const signal = await this.fraudSignals.create({ userId: finding.userId, type: "BOOKING_ABUSE", detail: finding.detail });
      await this.eventBus.publish(new FraudDetected(finding.userId, signal.id, "BOOKING_ABUSE", []));
      await this.recordBehaviorSignal.execute({
        userId: finding.userId,
        reason: "BOOKING_ABUSE_DETECTED",
        detail: finding.detail,
        referenceType: "FraudSignal",
        referenceId: signal.id,
      });
    }
    return findings.length;
  }
}
