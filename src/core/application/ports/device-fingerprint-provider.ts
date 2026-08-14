/**
 * Module 65 — Trust & Integrity System: requirement #5 — device
 * fingerprinting provider abstraction. No external SDK is integrated (per
 * the module brief's explicit instruction) — this port exists purely as
 * the seam a future provider (e.g. FingerprintJS Pro, a first-party
 * collector) plugs into, following the exact same "port + Null default +
 * env-selected factory" shape `VerificationProvider`
 * (`application/ports/verification-provider.ts`) already establishes for
 * Module 59.
 */
export interface DeviceFingerprintResult {
  /** Stable identifier for this device/browser instance, as computed by
   *  the concrete provider. Opaque to this module — never parsed, only
   *  compared for equality/clustering (see `fraud-detection-rules.ts`'s
   *  `detectSameDeviceClusters`). */
  deviceId: string;
  browserFingerprint: string | null;
  timezone: string | null;
  language: string | null;
  operatingSystem: string | null;
  platform: string | null;
}

export interface DeviceFingerprintProvider {
  readonly name: string;
  /** `rawSignal` is whatever opaque payload the client-side collector
   *  produced (a JSON blob, a token, ...) — this module never defines
   *  that shape itself, since no concrete collector is integrated yet. */
  fingerprint(rawSignal: unknown): Promise<DeviceFingerprintResult>;
}
