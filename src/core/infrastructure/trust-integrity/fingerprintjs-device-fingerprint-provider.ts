import { createHash } from "node:crypto";

import { FraudTrustProviderError } from "@/domain/errors/domain-error";
import { computeBackoffDelayMs } from "@/infrastructure/jobs/backoff";
import { logger } from "@/infrastructure/observability/logger";
import type { DeviceFingerprintProvider, DeviceFingerprintResult } from "@/application/ports/device-fingerprint-provider";

/**
 * Module 93 — Real Fraud & Trust Signal Providers: `DeviceFingerprintProvider`
 * backed by FingerprintJS Pro's Server API "Get event" endpoint
 * (https://dev.fingerprint.com/reference/getevent).
 *
 * ## Why FingerprintJS Pro
 * The purpose-built product for this exact signal — a stable
 * cross-session `visitorId` plus a server-verifiable `requestId`, EU data
 * region available (`eu.api.fpjs.io`, selected by default for this
 * Spain/EU-facing platform — see `FINGERPRINTJS_REGION`), and a
 * documented, versioned Server API rather than a bespoke fingerprinting
 * scheme this platform would have to build and maintain itself.
 *
 * ## The two-sided integration this adapter is one half of
 * FingerprintJS Pro's model requires a client-side JS agent to run in the
 * browser first — it produces a `visitorId` and, per identification
 * attempt, a `requestId` the server then verifies server-side (never
 * trusting a client-reported `visitorId` directly, which any client could
 * forge). **This adapter implements the server half only** — it expects
 * `rawSignal` to carry a `requestId` the client-side agent produced,
 * and calls FingerprintJS Pro's Server API to fetch the verified event
 * for that `requestId`. No FingerprintJS Pro JS agent is present anywhere
 * in this codebase's frontend today (confirmed at investigation time — no
 * `@fingerprintjs/fingerprintjs-pro` import anywhere in `src/`), so in
 * production, until that frontend agent is added, `rawSignal` will never
 * actually carry a `requestId`, and every call degrades to the low-
 * confidence fallback below. This is documented explicitly — never
 * silently — in MODULE_93_IMPLEMENTATION_REPORT.md's "Known limitations"
 * and "Production deployment requirements": the backend/adapter side of
 * this integration is real and production-capable; the frontend agent
 * that would make it *exercised* end-to-end is a separate, frontend-only
 * follow-up outside this backend module's scope.
 *
 * ## Graceful degradation — no `requestId`
 * When `rawSignal` has no usable `requestId` (today, always, per above),
 * this adapter does **not** throw or call FingerprintJS Pro at all — it
 * falls back to exactly `NullDeviceFingerprintProvider`'s own low-
 * confidence, JSON-hash-derived result (`confidence: null`, `provider:
 * "NULL"`), so a half-configured/half-deployed integration degrades to
 * "no real signal, but nothing broken" rather than either failing
 * registration or fabricating a fake FingerprintJS-attributed result.
 *
 * ## Fields read from the Server API response
 * Only `products.identification.data.visitorId`,
 * `.confidence.score`, and `.browserDetails.{userAgent,os,device}` are
 * read. Neither the visit's raw `ip`/`ipLocation` nor `incognito`/`vpn`
 * sub-products (FingerprintJS Pro can bundle its own VPN detection, but
 * this module deliberately keeps VPN/proxy detection on its own dedicated
 * IPQS adapter/port rather than duplicating that signal from a second
 * vendor) are ever read — data minimization, matching this module's IPQS
 * adapter.
 *
 * ## Data minimization / GDPR — `deviceId` storage decision
 * FingerprintJS Pro's `visitorId` is itself already a derived,
 * non-reversible identifier (not a raw browser/canvas/audio fingerprint
 * blob) — but it is still a stable cross-session identifier and therefore
 * personal data under GDPR when tied to a user. This adapter never
 * persists it itself (adapters never persist anything — see Clean
 * Architecture boundary); the caller
 * (`CollectFraudTrustSignalsUseCase`/`PrismaFraudTrustSignalCheckRepository`)
 * additionally SHA-256-hashes `deviceId` before writing any row (see that
 * repository's own doc comment) — this platform never stores a raw
 * FingerprintJS `visitorId` at rest, only a further-hashed derivative,
 * consistent with the module brief's explicit "hash it" option for a
 * high-cardinality provider identifier.
 *
 * ## Timeout, retry, failure semantics
 * Same shape as `PersonaClient`/`IpqsVpnProxyDetectionProvider`:
 * `AbortController` timeout (`FINGERPRINTJS_TIMEOUT_MS`, default 5s),
 * exponential backoff on network errors/timeouts/5xx/429, never on other
 * 4xx (a `requestId` FingerprintJS Pro doesn't recognize will never
 * succeed by retrying — treated as "no signal", not thrown, since a
 * stale/replayed `requestId` is client input, not a provider outage).
 */
export interface FingerprintJsDeviceFingerprintProviderOptions {
  secretApiKey: string;
  region?: "us" | "eu" | "ap";
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface FingerprintJsEventResponse {
  products?: {
    identification?: {
      data?: {
        visitorId?: string;
        confidence?: { score?: number };
        browserDetails?: {
          userAgent?: string;
          os?: string;
          osVersion?: string;
          device?: string;
        };
        timestamp?: number;
      };
    };
  };
}

const REGION_HOSTS: Record<"us" | "eu" | "ap", string> = {
  us: "https://api.fpjs.io",
  eu: "https://eu.api.fpjs.io",
  ap: "https://ap.api.fpjs.io",
};
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const PROVIDER_NAME = "FINGERPRINTJS";

function fallbackResult(rawSignal: unknown): DeviceFingerprintResult {
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

export class FingerprintJsDeviceFingerprintProvider implements DeviceFingerprintProvider {
  readonly name = "FINGERPRINTJS";

  private readonly secretApiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: FingerprintJsDeviceFingerprintProviderOptions) {
    this.secretApiKey = options.secretApiKey;
    this.baseUrl = options.baseUrl ?? REGION_HOSTS[options.region ?? "eu"];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async fingerprint(rawSignal: unknown): Promise<DeviceFingerprintResult> {
    const payload = typeof rawSignal === "object" && rawSignal !== null ? (rawSignal as Record<string, unknown>) : {};
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;

    if (!requestId) {
      // No client-agent-produced requestId available — see this class's
      // own doc comment ("Graceful degradation"). Not an error.
      return fallbackResult(rawSignal);
    }

    const correlationId = crypto.randomUUID();
    const url = `${this.baseUrl}/events/${encodeURIComponent(requestId)}`;

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = Date.now();

      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: { "Auth-API-Key": this.secretApiKey, Accept: "application/json" },
          signal: controller.signal,
        });
        const latencyMs = Date.now() - startedAt;

        if (response.status === 404 || response.status === 400) {
          // Stale/replayed/unrecognized requestId — client input, not a
          // provider outage. Degrade, do not throw.
          logger.warn("fraud_provider_call_failed", {
            provider: PROVIDER_NAME,
            operation: "fingerprint",
            correlationId,
            attempt,
            latencyMs,
            status: response.status,
            retryable: false,
          });
          return fallbackResult(rawSignal);
        }

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          logger.warn("fraud_provider_call_failed", {
            provider: PROVIDER_NAME,
            operation: "fingerprint",
            correlationId,
            attempt,
            latencyMs,
            status: response.status,
            retryable,
          });
          if (!retryable || attempt === this.maxAttempts) {
            throw new FraudTrustProviderError(
              "DEVICE_FINGERPRINT",
              PROVIDER_NAME,
              `FingerprintJS Pro request failed (HTTP ${response.status}).`,
              retryable,
            );
          }
          lastError = new Error(`HTTP ${response.status}`);
          clearTimeout(timer);
          await this.sleep(computeBackoffDelayMs(attempt, { type: "exponential", delay: 300, jitter: 0.2 }));
          continue;
        }

        const body = (await response.json()) as FingerprintJsEventResponse;
        const data = body.products?.identification?.data;

        if (!data?.visitorId) {
          logger.warn("fraud_provider_malformed_response", {
            provider: PROVIDER_NAME,
            operation: "fingerprint",
            correlationId,
            latencyMs,
          });
          return fallbackResult(rawSignal);
        }

        logger.info("fraud_provider_call_succeeded", {
          provider: PROVIDER_NAME,
          operation: "fingerprint",
          correlationId,
          attempt,
          latencyMs,
        });

        return {
          deviceId: data.visitorId,
          browserFingerprint: data.browserDetails?.userAgent ?? null,
          timezone: typeof payload.timezone === "string" ? payload.timezone : null,
          language: typeof payload.language === "string" ? payload.language : null,
          operatingSystem: data.browserDetails?.os ?? null,
          platform: data.browserDetails?.device ?? null,
          provider: PROVIDER_NAME,
          confidence:
            typeof data.confidence?.score === "number" ? Math.round(data.confidence.score * 100) : null,
          checkedAt: new Date(),
        };
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof FraudTrustProviderError) throw error;

        const isAbort = error instanceof Error && error.name === "AbortError";
        logger.warn("fraud_provider_call_error", {
          provider: PROVIDER_NAME,
          operation: "fingerprint",
          correlationId,
          attempt,
          timedOut: isAbort,
          error: error instanceof Error ? error.message : String(error),
        });

        if (attempt === this.maxAttempts) {
          throw new FraudTrustProviderError(
            "DEVICE_FINGERPRINT",
            PROVIDER_NAME,
            isAbort
              ? `FingerprintJS Pro request timed out after ${this.timeoutMs}ms.`
              : "FingerprintJS Pro request failed due to a network error.",
            true,
            { cause: error },
          );
        }
        lastError = error;
        await this.sleep(computeBackoffDelayMs(attempt, { type: "exponential", delay: 300, jitter: 0.2 }));
      } finally {
        clearTimeout(timer);
      }
    }

    throw new FraudTrustProviderError(
      "DEVICE_FINGERPRINT",
      PROVIDER_NAME,
      "FingerprintJS Pro request failed.",
      true,
      { cause: lastError },
    );
  }
}
