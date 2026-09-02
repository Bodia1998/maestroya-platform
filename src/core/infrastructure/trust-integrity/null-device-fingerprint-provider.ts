import { createHash } from "node:crypto";
import type { DeviceFingerprintProvider, DeviceFingerprintResult } from "@/application/ports/device-fingerprint-provider";

/**
 * Module 65 — Trust & Integrity System: default `DeviceFingerprintProvider`
 * used whenever no real fingerprinting SDK is configured (Module 93
 * still selects this — never throws, never fails a caller — whenever
 * `FRAUD_DEVICE_FINGERPRINT_PROVIDER` is unset/`null` or misconfigured;
 * see `trust-integrity-provider-factory.ts`). Not a throwing "Null" in
 * the `NullVerificationProvider` sense — a device-fingerprint signal is
 * always optional context, never a hard dependency any use case requires
 * to function, so this returns a best-effort, low-confidence result
 * derived only from `rawSignal`'s own JSON shape (if any) rather than
 * failing loudly. A real provider (`FingerprintJsDeviceFingerprintProvider`)
 * replaces this via `trust-integrity-provider-factory.ts` without any call
 * site changing.
 */
export class NullDeviceFingerprintProvider implements DeviceFingerprintProvider {
  readonly name = "NULL";

  async fingerprint(rawSignal: unknown): Promise<DeviceFingerprintResult> {
    const payload = typeof rawSignal === "object" && rawSignal !== null ? (rawSignal as Record<string, unknown>) : {};
    const hashSource = JSON.stringify(payload);
    const deviceId = createHash("sha256").update(hashSource).digest("hex");

    return {
      deviceId,
      browserFingerprint: typeof payload.userAgent === "string" ? payload.userAgent : null,
      timezone: typeof payload.timezone === "string" ? payload.timezone : null,
      language: typeof payload.language === "string" ? payload.language : null,
      operatingSystem: typeof payload.os === "string" ? payload.os : null,
      platform: typeof payload.platform === "string" ? payload.platform : null,
      provider: "NULL",
      confidence: null,
      checkedAt: new Date(),
    };
  }
}
