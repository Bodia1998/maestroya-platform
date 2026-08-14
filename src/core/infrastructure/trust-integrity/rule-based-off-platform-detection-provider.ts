import type { OffPlatformDetectionProvider } from "@/application/ports/off-platform-detection-provider";
import type { OffPlatformSignal } from "@/domain/services/off-platform-detection-rules";
import { detectOffPlatformSignals } from "@/domain/services/off-platform-detection-rules";

/**
 * Module 65 — Trust & Integrity System: the always-available
 * `OffPlatformDetectionProvider` implementation, delegating straight to
 * the domain rule engine (`off-platform-detection-rules.ts`) — see that
 * port's own doc comment for why this, not an AI classifier, is the
 * default and only implementation today.
 */
export class RuleBasedOffPlatformDetectionProvider implements OffPlatformDetectionProvider {
  readonly name = "RULE_BASED";

  async detect(text: string): Promise<OffPlatformSignal[]> {
    return detectOffPlatformSignals(text);
  }
}
