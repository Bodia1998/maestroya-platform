import type { VpnProxyDetectionProvider, VpnProxyDetectionResult } from "@/application/ports/vpn-proxy-detection-provider";

/**
 * Module 65 — Trust & Integrity System: default `VpnProxyDetectionProvider`
 * used whenever no real IP-intelligence provider is configured (Module 93
 * still selects this whenever `FRAUD_VPN_PROXY_PROVIDER` is unset/`null`
 * or misconfigured — see `trust-integrity-provider-factory.ts`). Always
 * reports `UNKNOWN`/zero confidence with every granular field `null`
 * rather than guessing — "signal unavailable", never treated as "fraud"
 * by anything downstream, per the module brief's explicit rule. A real
 * provider (`IpqsVpnProxyDetectionProvider`) replaces this via the
 * factory without any call site changing.
 */
export class NullVpnProxyDetectionProvider implements VpnProxyDetectionProvider {
  readonly name = "NULL";

  async classify(_input: { ipHash: string; ip: string }): Promise<VpnProxyDetectionResult> {
    return {
      classification: "UNKNOWN",
      confidence: 0,
      isVpn: null,
      isProxy: null,
      isTor: null,
      isHosting: null,
      riskLevel: "UNKNOWN",
      provider: "NULL",
      checkedAt: new Date(),
    };
  }
}
