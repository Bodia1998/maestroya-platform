import type { DeviceFingerprintProvider } from "@/application/ports/device-fingerprint-provider";
import type { VpnProxyDetectionProvider } from "@/application/ports/vpn-proxy-detection-provider";
import type { DisposableEmailProvider } from "@/application/ports/disposable-email-provider";
import type { PhoneReputationProvider } from "@/application/ports/phone-reputation-provider";
import type { OffPlatformDetectionProvider } from "@/application/ports/off-platform-detection-provider";
import { NullDeviceFingerprintProvider } from "@/infrastructure/trust-integrity/null-device-fingerprint-provider";
import { NullVpnProxyDetectionProvider } from "@/infrastructure/trust-integrity/null-vpn-proxy-detection-provider";
import { StaticListDisposableEmailProvider } from "@/infrastructure/trust-integrity/static-list-disposable-email-provider";
import { NullPhoneReputationProvider } from "@/infrastructure/trust-integrity/null-phone-reputation-provider";
import { RuleBasedOffPlatformDetectionProvider } from "@/infrastructure/trust-integrity/rule-based-off-platform-detection-provider";

/**
 * Module 65 — Trust & Integrity System: the single place that decides
 * which concrete implementation each of this module's five provider ports
 * gets — the same memoized-singleton-per-process shape
 * `verification-provider-factory.ts`/`search-provider-factory.ts` already
 * establish. Every factory below returns today's only implementation
 * (no external SDK is integrated, per the module brief), but is kept as
 * its own function — rather than callers `new`-ing the class directly —
 * so a future env-driven selection (e.g. `DEVICE_FINGERPRINT_PROVIDER=
 * fingerprintjs`, mirroring `VERIFICATION_PROVIDER`/`SEARCH_PROVIDER`)
 * only ever changes this one file, exactly like every other provider
 * factory in this codebase.
 */
let deviceFingerprintProvider: DeviceFingerprintProvider | null = null;
let vpnProxyDetectionProvider: VpnProxyDetectionProvider | null = null;
let disposableEmailProvider: DisposableEmailProvider | null = null;
let phoneReputationProvider: PhoneReputationProvider | null = null;
let offPlatformDetectionProvider: OffPlatformDetectionProvider | null = null;

export function createDeviceFingerprintProvider(): DeviceFingerprintProvider {
  if (!deviceFingerprintProvider) deviceFingerprintProvider = new NullDeviceFingerprintProvider();
  return deviceFingerprintProvider;
}

export function createVpnProxyDetectionProvider(): VpnProxyDetectionProvider {
  if (!vpnProxyDetectionProvider) vpnProxyDetectionProvider = new NullVpnProxyDetectionProvider();
  return vpnProxyDetectionProvider;
}

export function createDisposableEmailProvider(): DisposableEmailProvider {
  if (!disposableEmailProvider) disposableEmailProvider = new StaticListDisposableEmailProvider();
  return disposableEmailProvider;
}

export function createPhoneReputationProvider(): PhoneReputationProvider {
  if (!phoneReputationProvider) phoneReputationProvider = new NullPhoneReputationProvider();
  return phoneReputationProvider;
}

export function createOffPlatformDetectionProvider(): OffPlatformDetectionProvider {
  if (!offPlatformDetectionProvider) offPlatformDetectionProvider = new RuleBasedOffPlatformDetectionProvider();
  return offPlatformDetectionProvider;
}

/** Exposed for tests only — forces every provider to be re-decided on the
 *  next call. */
export const __testing = {
  reset(): void {
    deviceFingerprintProvider = null;
    vpnProxyDetectionProvider = null;
    disposableEmailProvider = null;
    phoneReputationProvider = null;
    offPlatformDetectionProvider = null;
  },
};
