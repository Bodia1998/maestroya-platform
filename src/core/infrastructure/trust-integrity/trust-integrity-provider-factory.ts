import "server-only";

import type { DeviceFingerprintProvider } from "@/application/ports/device-fingerprint-provider";
import type { VpnProxyDetectionProvider } from "@/application/ports/vpn-proxy-detection-provider";
import type { DisposableEmailProvider } from "@/application/ports/disposable-email-provider";
import type { PhoneReputationProvider } from "@/application/ports/phone-reputation-provider";
import type { OffPlatformDetectionProvider } from "@/application/ports/off-platform-detection-provider";
import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import { NullDeviceFingerprintProvider } from "@/infrastructure/trust-integrity/null-device-fingerprint-provider";
import { NullVpnProxyDetectionProvider } from "@/infrastructure/trust-integrity/null-vpn-proxy-detection-provider";
import { StaticListDisposableEmailProvider } from "@/infrastructure/trust-integrity/static-list-disposable-email-provider";
import { NullPhoneReputationProvider } from "@/infrastructure/trust-integrity/null-phone-reputation-provider";
import { RuleBasedOffPlatformDetectionProvider } from "@/infrastructure/trust-integrity/rule-based-off-platform-detection-provider";
import { FingerprintJsDeviceFingerprintProvider } from "@/infrastructure/trust-integrity/fingerprintjs-device-fingerprint-provider";
import { IpqsVpnProxyDetectionProvider } from "@/infrastructure/trust-integrity/ipqs-vpn-proxy-detection-provider";
import { TwilioLookupPhoneReputationProvider } from "@/infrastructure/trust-integrity/twilio-lookup-phone-reputation-provider";

/**
 * Module 65 — Trust & Integrity System, real adapters wired in by
 * Module 93 — Real Fraud & Trust Signal Providers.
 *
 * The single place that decides which concrete implementation each of
 * this module's five provider ports gets — the same memoized-singleton-
 * per-process shape `verification-provider-factory.ts`/
 * `search-provider-factory.ts` already establish.
 *
 * ## Fallback, never failure (outside production)
 * Same rule `verification-provider-factory.ts` documents for Persona:
 * a real provider selected via env (`FRAUD_DEVICE_FINGERPRINT_PROVIDER=
 * fingerprintjs`, etc.) with missing credentials falls back to the
 * matching Null provider with a warning rather than throwing at
 * construction time. A production deployment that deliberately selects a
 * real provider still fails fast at `env.ts`'s own `.superRefine` block —
 * this fallback only covers a process that somehow reaches here with an
 * invalid combination anyway (e.g. a non-production environment, or a
 * build step that runs before `.superRefine`'s production-only checks
 * apply).
 *
 * ## Production no longer silently resolves to Null
 * Before Module 93, all three of these factories unconditionally
 * returned their Null implementation — this was requirement #93's
 * central defect (see MODULE_93_IMPLEMENTATION_REPORT.md §2). Now, each
 * factory's decision is entirely driven by the matching env selector; a
 * production deployment resolves to a real adapter whenever that
 * selector was set to a real provider (which `.superRefine` additionally
 * requires to be fully configured) — `null`/misconfigured is only ever
 * reached via an explicit, visible-in-deployment-config choice, never a
 * silent default a real provider was supposed to replace.
 */
let deviceFingerprintProvider: DeviceFingerprintProvider | null = null;
let vpnProxyDetectionProvider: VpnProxyDetectionProvider | null = null;
let disposableEmailProvider: DisposableEmailProvider | null = null;
let phoneReputationProvider: PhoneReputationProvider | null = null;
let offPlatformDetectionProvider: OffPlatformDetectionProvider | null = null;

export function createDeviceFingerprintProvider(): DeviceFingerprintProvider {
  if (!deviceFingerprintProvider) deviceFingerprintProvider = buildDeviceFingerprintProvider();
  return deviceFingerprintProvider;
}

function buildDeviceFingerprintProvider(): DeviceFingerprintProvider {
  if (env.FRAUD_DEVICE_FINGERPRINT_PROVIDER !== "fingerprintjs") {
    return new NullDeviceFingerprintProvider();
  }

  if (!env.FINGERPRINTJS_SECRET_API_KEY) {
    logger.warn("fraud_provider_misconfigured", {
      provider: "fingerprintjs",
      reason: "FINGERPRINTJS_SECRET_API_KEY is not set — falling back to the Null device-fingerprint provider.",
    });
    return new NullDeviceFingerprintProvider();
  }

  return new FingerprintJsDeviceFingerprintProvider({
    secretApiKey: env.FINGERPRINTJS_SECRET_API_KEY,
    region: env.FINGERPRINTJS_REGION,
    timeoutMs: env.FINGERPRINTJS_TIMEOUT_MS,
  });
}

export function createVpnProxyDetectionProvider(): VpnProxyDetectionProvider {
  if (!vpnProxyDetectionProvider) vpnProxyDetectionProvider = buildVpnProxyDetectionProvider();
  return vpnProxyDetectionProvider;
}

function buildVpnProxyDetectionProvider(): VpnProxyDetectionProvider {
  if (env.FRAUD_VPN_PROXY_PROVIDER !== "ipqs") {
    return new NullVpnProxyDetectionProvider();
  }

  if (!env.IPQS_API_KEY) {
    logger.warn("fraud_provider_misconfigured", {
      provider: "ipqs",
      reason: "IPQS_API_KEY is not set — falling back to the Null VPN/proxy-detection provider.",
    });
    return new NullVpnProxyDetectionProvider();
  }

  return new IpqsVpnProxyDetectionProvider({ apiKey: env.IPQS_API_KEY, timeoutMs: env.IPQS_TIMEOUT_MS });
}

export function createDisposableEmailProvider(): DisposableEmailProvider {
  if (!disposableEmailProvider) disposableEmailProvider = new StaticListDisposableEmailProvider();
  return disposableEmailProvider;
}

export function createPhoneReputationProvider(): PhoneReputationProvider {
  if (!phoneReputationProvider) phoneReputationProvider = buildPhoneReputationProvider();
  return phoneReputationProvider;
}

function buildPhoneReputationProvider(): PhoneReputationProvider {
  if (env.FRAUD_PHONE_REPUTATION_PROVIDER !== "twilio_lookup") {
    return new NullPhoneReputationProvider();
  }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    logger.warn("fraud_provider_misconfigured", {
      provider: "twilio_lookup",
      reason: "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not set — falling back to the Null phone-reputation provider.",
    });
    return new NullPhoneReputationProvider();
  }

  return new TwilioLookupPhoneReputationProvider({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    timeoutMs: env.TWILIO_LOOKUP_TIMEOUT_MS,
  });
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
