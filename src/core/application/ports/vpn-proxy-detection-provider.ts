/**
 * Module 65 — Trust & Integrity System (requirement #6), revised by
 * Module 93 — Real Fraud & Trust Signal Providers.
 *
 * ## What changed from Module 65's original shape, and why
 * Module 65 shipped `classify(ipHash: string)` — architecture only, no
 * real provider. That signature cannot actually be implemented by a real
 * IP-intelligence API: every such provider (this module selects
 * IPQualityScore — see the adapter's own doc comment) is queried by raw
 * IP address; a keyed hash cannot be reversed back into one. Module 65's
 * own doc comment anticipated this exact gap ("a real provider
 * implementation resolves the raw IP server-side just before calling
 * out, from the same request context that produced the hash") but never
 * updated the signature to carry that raw IP through. Module 93 fixes
 * this — the one deliberate, documented architecture correction this
 * module makes (see MODULE_93_IMPLEMENTATION_REPORT.md §2/§11) — by
 * having `classify` accept both: `ipHash` (for logging/correlation,
 * matching `SecurityEvent.ipHash`'s existing convention) and `ip` (the
 * raw address, used only for the outbound provider call and never
 * logged, persisted, or returned in the result). `ip` is resolved by the
 * caller (`CollectFraudTrustSignalsUseCase`'s own Server Action caller,
 * e.g. `registerAction`) from the same request headers
 * `getClientIpHash()` already reads (see infrastructure/auth/
 * request-context.ts's new `getClientIp()`), and lives only for the
 * duration of this one call — this port, and everything downstream of
 * it (the fraud/trust decision layer, persistence), still only ever sees
 * `ipHash` in anything that gets stored or logged.
 */
export type IpClassification = "CLEAN" | "VPN" | "TOR" | "DATACENTER_PROXY" | "RESIDENTIAL_PROXY" | "UNKNOWN";

/** Coarse decision-ready bucket a fraud policy can switch on without
 *  re-deriving thresholds itself — see the IPQS adapter's own doc comment
 *  for exactly how `fraud_score` maps to this. */
export type IpRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

export interface VpnProxyDetectionResult {
  /** Kept for backward compatibility with Module 65's original shape and
   *  any existing caller that only needs one coarse bucket — derived from
   *  the granular booleans below (priority: TOR > DATACENTER_PROXY >
   *  RESIDENTIAL_PROXY > VPN > CLEAN). */
  classification: IpClassification;
  /** 0-100 confidence the provider assigns to `classification` — for the
   *  IPQS adapter this is `fraud_score` verbatim, kept 0-100 so callers
   *  never have to know which provider produced it. */
  confidence: number;
  /** Only the fields the selected provider actually supports are ever
   *  set to a real boolean — an unsupported field is `null`, never
   *  guessed. IPQS supports all four for every successful response. */
  isVpn: boolean | null;
  isProxy: boolean | null;
  isTor: boolean | null;
  isHosting: boolean | null;
  riskLevel: IpRiskLevel;
  /** "NULL" for the degraded default, "IPQS" for the real adapter. */
  provider: string;
  checkedAt: Date;
}

export interface VpnProxyDetectionProvider {
  readonly name: string;
  /** `ipHash` — same keyed-hash convention `SecurityEvent.ipHash` already
   *  uses, passed through purely so the adapter can log/correlate without
   *  ever handling the raw IP outside this one call. `ip` — the raw
   *  address, used only to build the outbound request to the provider;
   *  never logged, never included in the returned result, never
   *  persisted by any caller of this port (see `FraudTrustSignalCheck`'s
   *  own doc comment in schema.prisma). Never throws for "provider
   *  unavailable" — see `VpnProxyDetectionProviderError` for the one
   *  exception (a genuine provider-side failure), which
   *  `CollectFraudTrustSignalsUseCase` always catches and downgrades to
   *  an `UNKNOWN`-classified, unavailable signal rather than treating an
   *  outage as `fraud = true`. */
  classify(input: { ipHash: string; ip: string }): Promise<VpnProxyDetectionResult>;
}
