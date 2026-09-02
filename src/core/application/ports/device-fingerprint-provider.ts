/**
 * Module 65 — Trust & Integrity System (requirement #5), revised by
 * Module 93 — Real Fraud & Trust Signal Providers.
 *
 * Module 65 deliberately shipped this as architecture-only ("no external
 * SDK integrated"). Module 93 replaces the production default
 * (`NullDeviceFingerprintProvider`) with a real adapter
 * (`FingerprintJsDeviceFingerprintProvider`,
 * infrastructure/trust-integrity/fingerprintjs-device-fingerprint-provider.ts)
 * without changing this port's shape for any existing caller —
 * `fraud-detection-rules.ts`'s `detectSameDeviceClusters` only ever
 * consumes `deviceId` as an opaque comparison key, so every field below
 * stays backward compatible with Module 65's original contract.
 */
export interface DeviceFingerprintResult {
  /** Stable identifier for this device/browser instance, as computed by
   *  the concrete provider. Opaque to this module — never parsed, only
   *  compared for equality/clustering (see `fraud-detection-rules.ts`'s
   *  `detectSameDeviceClusters`). For a real provider this is already a
   *  provider-issued visitor/device id, not a raw fingerprint — never a
   *  browser canvas/audio fingerprint blob, consistent with GDPR data
   *  minimization (see the adapter's own doc comment for the full privacy
   *  review). */
  deviceId: string;
  browserFingerprint: string | null;
  timezone: string | null;
  language: string | null;
  operatingSystem: string | null;
  platform: string | null;
  /** Which concrete provider produced this result — "NULL" for the
   *  degraded/no-signal default, a real provider's own name otherwise
   *  (e.g. "FINGERPRINTJS"). Lets the fraud/trust decision layer, and any
   *  audit trail, distinguish "no real signal was available" from "a real
   *  provider says these devices match" without inspecting confidence
   *  alone. */
  provider: string;
  /** 0-100 confidence this is a genuinely returning device, when the
   *  provider exposes one; `null` when the provider gives no confidence
   *  signal (e.g. the Null provider, or a provider outage). A device
   *  fingerprint is never treated as absolute proof of identity — see
   *  the real adapter's own doc comment — this is advisory input to
   *  `fraud-detection-rules.ts`, never a standalone verdict. */
  confidence: number | null;
  checkedAt: Date;
}

export interface DeviceFingerprintProvider {
  readonly name: string;
  /** `rawSignal` is whatever opaque payload the client-side collector
   *  produced (a JSON blob, a token, ...) — this module never defines
   *  that shape itself, since no concrete collector is integrated yet.
   *  A real provider never throws for "no usable signal in `rawSignal`"
   *  — it returns a low-confidence/`provider: "NULL"`-equivalent result
   *  instead (see each adapter's own "graceful degradation" section);
   *  it only throws `DeviceFingerprintProviderError` for a genuine
   *  provider-side failure (timeout, 5xx, malformed response), which the
   *  caller (`CollectFraudTrustSignalsUseCase`) always catches and
   *  degrades to "signal unavailable" rather than letting propagate. */
  fingerprint(rawSignal: unknown): Promise<DeviceFingerprintResult>;
}
