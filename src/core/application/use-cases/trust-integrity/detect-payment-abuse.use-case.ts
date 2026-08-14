import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { FraudDetected } from "@/domain/events/fraud-detected";
import {
  detectChargebackAbuse,
  detectRefundAbuse,
  detectPaymentManipulation,
  type ChargebackActivityInput,
  type RefundActivityInput,
  type PaymentManipulationInput,
} from "@/domain/services/payment-abuse-detection-rules";

/** Module 65 — Trust & Integrity System: requirement #13 — architecture
 *  only (see the rule engine's own doc comment); no Stripe integration. */
export interface DetectPaymentAbuseInput {
  chargebackActivity?: ChargebackActivityInput[];
  refundActivity?: RefundActivityInput[];
  paymentManipulation?: PaymentManipulationInput[];
}

export class DetectPaymentAbuseUseCase {
  constructor(
    private readonly fraudSignals: FraudSignalRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: DetectPaymentAbuseInput): Promise<number> {
    const findings = [
      ...(input.chargebackActivity ?? []).map(detectChargebackAbuse),
      ...(input.refundActivity ?? []).map(detectRefundAbuse),
      ...(input.paymentManipulation ?? []).flatMap(detectPaymentManipulation),
    ].filter((f): f is NonNullable<typeof f> => f !== null);

    for (const finding of findings) {
      const signal = await this.fraudSignals.create({ userId: finding.userId, type: "PAYMENT_ABUSE", detail: finding.detail });
      await this.eventBus.publish(new FraudDetected(finding.userId, signal.id, "PAYMENT_ABUSE", []));
      await this.recordBehaviorSignal.execute({
        userId: finding.userId,
        reason: "PAYMENT_ABUSE_DETECTED",
        detail: finding.detail,
        referenceType: "FraudSignal",
        referenceId: signal.id,
      });
    }
    return findings.length;
  }
}
