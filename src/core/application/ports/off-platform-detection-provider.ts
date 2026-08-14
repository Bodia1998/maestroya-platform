import type { OffPlatformSignal } from "@/domain/services/off-platform-detection-rules";

/**
 * Module 65 — Trust & Integrity System: requirement #3 — "Create provider
 * interfaces and rule engine only." This port is the seam between
 * `DetectOffPlatformCommunicationUseCase` and whatever actually classifies
 * text; `RuleBasedOffPlatformDetectionProvider`
 * (infrastructure/trust-integrity/) is the always-available default,
 * delegating straight to `domain/services/off-platform-detection-rules.ts`
 * — never AI-backed, per the module brief. A future, smarter backend
 * implements this same interface without any use case changing.
 */
export interface OffPlatformDetectionProvider {
  readonly name: string;
  detect(text: string): Promise<OffPlatformSignal[]>;
}
