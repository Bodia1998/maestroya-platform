import type { VpnProxyDetectionProvider, VpnProxyDetectionResult } from "@/application/ports/vpn-proxy-detection-provider";

/**
 * Module 65 — Trust & Integrity System: default `VpnProxyDetectionProvider`
 * — architecture only (requirement #6), no IP-intelligence SDK is
 * integrated, so this always reports `UNKNOWN` with zero confidence rather
 * than guessing. A future provider (e.g. IPQualityScore, MaxMind)
 * implements the same interface and is selected in
 * `trust-integrity-provider-factory.ts`.
 */
export class NullVpnProxyDetectionProvider implements VpnProxyDetectionProvider {
  readonly name = "NULL";

  async classify(_ipHash: string): Promise<VpnProxyDetectionResult> {
    return { classification: "UNKNOWN", confidence: 0 };
  }
}
