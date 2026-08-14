import type { OffPlatformDetectionProvider } from "@/application/ports/off-platform-detection-provider";
import type { OffPlatformDetectionRepository } from "@/domain/repositories/off-platform-detection-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { hasHighConfidenceSignal } from "@/domain/services/off-platform-detection-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { OffPlatformDetected } from "@/domain/events/off-platform-detected";
import type { DetectOffPlatformCommunicationInput } from "@/application/dto/trust-integrity.dto";

/**
 * Module 65 — Trust & Integrity System: requirement #3. Runs the
 * off-platform detection provider (rule engine by default — see
 * `off-platform-detection-provider.ts`) against one piece of user-authored
 * text, persists one `OffPlatformDetectionEvent` per distinct channel
 * matched, and — only for a high-confidence match — feeds
 * `RecordUserBehaviorSignalUseCase` so repeated off-platform attempts
 * actually move the Risk Score (a single low-confidence match, e.g. a bare
 * 7-digit number, is recorded for visibility but does not move the score
 * on its own).
 */
export interface DetectOffPlatformCommunicationResult {
  signalsDetected: number;
  highConfidence: boolean;
}

export class DetectOffPlatformCommunicationUseCase {
  constructor(
    private readonly provider: OffPlatformDetectionProvider,
    private readonly events: OffPlatformDetectionRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: DetectOffPlatformCommunicationInput): Promise<DetectOffPlatformCommunicationResult> {
    const signals = await this.provider.detect(input.text);
    if (signals.length === 0) return { signalsDetected: 0, highConfidence: false };

    for (const signal of signals) {
      await this.events.create({
        userId: input.userId,
        channel: signal.channel,
        matchedText: signal.matchedText,
        confidence: signal.confidence,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      });
      await this.eventBus.publish(
        new OffPlatformDetected(input.userId, signal.channel, signal.confidence, input.sourceType, input.sourceId),
      );
    }

    const highConfidence = hasHighConfidenceSignal(signals);
    if (highConfidence) {
      await this.recordBehaviorSignal.execute({
        userId: input.userId,
        reason: "OFF_PLATFORM_SIGNAL_DETECTED",
        detail: `${signals.length} off-platform signal(s) detected in a ${input.sourceType.toLowerCase()} (channels: ${signals.map((s) => s.channel).join(", ")}).`,
        referenceType: input.sourceType,
        referenceId: input.sourceId,
      });
    }

    return { signalsDetected: signals.length, highConfidence };
  }
}
