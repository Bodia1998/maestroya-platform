/**
 * Module 65 — Trust & Integrity System: requirement #6 — VPN/proxy
 * detection provider abstraction. Architecture only, per the module
 * brief — no external IP-intelligence SDK is integrated.
 */
export type IpClassification = "CLEAN" | "VPN" | "TOR" | "DATACENTER_PROXY" | "RESIDENTIAL_PROXY" | "UNKNOWN";

export interface VpnProxyDetectionResult {
  classification: IpClassification;
  /** 0-100 confidence the provider assigns to `classification`. */
  confidence: number;
}

export interface VpnProxyDetectionProvider {
  readonly name: string;
  /** `ipHash` — same keyed-hash convention `SecurityEvent.ipHash` already
   *  uses; this port never receives a raw IP address, consistent with
   *  this codebase's "never persist/pass around a raw IP" rule. A real
   *  provider implementation resolves the raw IP server-side just before
   *  calling out, from the same request context that produced the hash —
   *  this module's own callers never need the raw value. */
  classify(ipHash: string): Promise<VpnProxyDetectionResult>;
}
