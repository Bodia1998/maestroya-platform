import { FraudTrustProviderError } from "@/domain/errors/domain-error";
import { computeBackoffDelayMs } from "@/infrastructure/jobs/backoff";
import { logger } from "@/infrastructure/observability/logger";
import type {
  IpClassification,
  IpRiskLevel,
  VpnProxyDetectionProvider,
  VpnProxyDetectionResult,
} from "@/application/ports/vpn-proxy-detection-provider";

/**
 * Module 93 — Real Fraud & Trust Signal Providers: `VpnProxyDetectionProvider`
 * backed by IPQualityScore's Proxy Detection API
 * (https://www.ipqualityscore.com/documentation/proxy-detection/overview).
 *
 * ## Why IPQualityScore
 * Selected over MaxMind GeoIP2 Anonymous IP (coarser — VPN/proxy/Tor/
 * hosting only, no numeric risk score) and IPinfo (privacy-detection add-on
 * is a separate, pricier product) because it is the one option in this
 * category whose single REST call returns every field this module's port
 * needs (`vpn`, `proxy`, `tor`, a datacenter/hosting signal, and a 0-100
 * `fraud_score`) without a second lookup, has no EU-data-residency
 * restriction that would complicate GDPR review for this Spain/EU-facing
 * platform, and — like Persona/Twilio elsewhere in this codebase — is a
 * single well-documented JSON endpoint, not a package with its own
 * dependency tree, so this adapter calls it with plain `fetch`, matching
 * `PersonaClient`'s own "no vendor SDK for one REST endpoint" precedent.
 *
 * ## Endpoint and fields actually used
 * `GET https://ipqualityscore.com/api/json/ip/{apiKey}/{ip}?strictness=1&fast=1`
 * (`strictness=1` — light additional checks beyond the default, still
 * fast enough for an inline request-path call; `fast=1` skips IPQS's
 * slower/deeper checks not needed here). Only fields this adapter has
 * verified against IPQS's own documentation are read: `success`,
 * `message`, `fraud_score`, `proxy`, `vpn`, `tor`, `connection_type`
 * (used only to detect `"Data Center"` for `isHosting` — every other
 * `connection_type` value is ignored, never surfaced). No other field in
 * IPQS's response (recent_abuse, bot_status, ISP, ASN, geolocation, ...)
 * is read, stored, or logged by this adapter — this module only takes
 * what its port actually asks for (data minimization, per the module
 * brief's GDPR review requirement).
 *
 * ## riskLevel thresholds
 * MaestroYa's own bucketing of IPQS's `fraud_score` (IPQS itself does not
 * define named buckets): 0-24 LOW, 25-59 MEDIUM, 60-84 HIGH, 85-100
 * CRITICAL. Documented here as this module's own policy decision, not a
 * value IPQS's API returns directly.
 *
 * ## Timeout, retry, failure semantics
 * Same shape as `PersonaClient`: `AbortController`-based timeout
 * (`IPQS_TIMEOUT_MS`, default 4s — this call sits inline in the
 * registration request path, so it must resolve fast or degrade),
 * exponential backoff retry (`computeBackoffDelayMs`, `{ type:
 * "exponential", delay: 300, jitter: 0.2 }`) on network errors/timeouts/
 * 5xx/429, never on 4xx (a malformed IP will never succeed on retry).
 * IPQS returns HTTP 200 with `"success": false` for its own
 * application-level failures (invalid key, invalid IP, over quota) rather
 * than a non-2xx status — this adapter treats `success: false` as a
 * `FraudTrustProviderError` exactly like a transport-level failure, with
 * `retryable: false` (a malformed key/IP will not succeed by retrying).
 *
 * ## Privacy
 * The raw IP is sent to IPQS over HTTPS and appears only in the outbound
 * URL for the duration of this one call — never logged (the log lines
 * below use `ipHash` only), never persisted by this class. IPQS's own
 * data-retention policy governs what IPQS itself retains; this platform
 * does not control that, which is why `ip` is passed through this port
 * (see that port's own doc comment) rather than being resolved inside a
 * generic HTTP layer that might log full request URLs.
 */
export interface IpqsVpnProxyDetectionProviderOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface IpqsResponse {
  success: boolean;
  message?: string;
  fraud_score?: number;
  proxy?: boolean;
  vpn?: boolean;
  tor?: boolean;
  connection_type?: string;
}

const DEFAULT_BASE_URL = "https://ipqualityscore.com/api/json/ip";
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const PROVIDER_NAME = "IPQS";

function toRiskLevel(fraudScore: number): IpRiskLevel {
  if (fraudScore >= 85) return "CRITICAL";
  if (fraudScore >= 60) return "HIGH";
  if (fraudScore >= 25) return "MEDIUM";
  return "LOW";
}

function toClassification(input: { tor: boolean; hosting: boolean; proxy: boolean; vpn: boolean }): IpClassification {
  if (input.tor) return "TOR";
  if (input.hosting) return "DATACENTER_PROXY";
  if (input.proxy) return "RESIDENTIAL_PROXY";
  if (input.vpn) return "VPN";
  return "CLEAN";
}

export class IpqsVpnProxyDetectionProvider implements VpnProxyDetectionProvider {
  readonly name = "IPQS";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: IpqsVpnProxyDetectionProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async classify(input: { ipHash: string; ip: string }): Promise<VpnProxyDetectionResult> {
    const correlationId = crypto.randomUUID();
    const url = `${this.baseUrl}/${encodeURIComponent(this.apiKey)}/${encodeURIComponent(input.ip)}?strictness=1&fast=1`;

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = Date.now();

      try {
        const response = await this.fetchImpl(url, { method: "GET", signal: controller.signal });
        const latencyMs = Date.now() - startedAt;

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          logger.warn("fraud_provider_call_failed", {
            provider: PROVIDER_NAME,
            operation: "classify",
            correlationId,
            ipHash: input.ipHash,
            attempt,
            latencyMs,
            status: response.status,
            retryable,
          });
          if (!retryable || attempt === this.maxAttempts) {
            throw new FraudTrustProviderError(
              "VPN_PROXY_DETECTION",
              PROVIDER_NAME,
              `IPQS request failed (HTTP ${response.status}).`,
              retryable,
            );
          }
          lastError = new Error(`HTTP ${response.status}`);
          clearTimeout(timer);
          await this.sleep(computeBackoffDelayMs(attempt, { type: "exponential", delay: 300, jitter: 0.2 }));
          continue;
        }

        const body = (await response.json()) as IpqsResponse;

        if (
          body.success !== true ||
          typeof body.fraud_score !== "number" ||
          typeof body.proxy !== "boolean" ||
          typeof body.vpn !== "boolean" ||
          typeof body.tor !== "boolean"
        ) {
          logger.warn("fraud_provider_malformed_response", {
            provider: PROVIDER_NAME,
            operation: "classify",
            correlationId,
            ipHash: input.ipHash,
            latencyMs,
            success: body.success,
          });
          throw new FraudTrustProviderError(
            "VPN_PROXY_DETECTION",
            PROVIDER_NAME,
            body.message ?? "IPQS returned a malformed or unsuccessful response.",
            false,
          );
        }

        const isHosting = body.connection_type === "Data Center";
        const fraudScore = Math.min(100, Math.max(0, Math.round(body.fraud_score)));

        logger.info("fraud_provider_call_succeeded", {
          provider: PROVIDER_NAME,
          operation: "classify",
          correlationId,
          ipHash: input.ipHash,
          attempt,
          latencyMs,
        });

        return {
          classification: toClassification({ tor: body.tor, hosting: isHosting, proxy: body.proxy, vpn: body.vpn }),
          confidence: fraudScore,
          isVpn: body.vpn,
          isProxy: body.proxy,
          isTor: body.tor,
          isHosting,
          riskLevel: toRiskLevel(fraudScore),
          provider: PROVIDER_NAME,
          checkedAt: new Date(),
        };
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof FraudTrustProviderError) throw error;

        const isAbort = error instanceof Error && error.name === "AbortError";
        logger.warn("fraud_provider_call_error", {
          provider: PROVIDER_NAME,
          operation: "classify",
          correlationId,
          ipHash: input.ipHash,
          attempt,
          timedOut: isAbort,
          error: error instanceof Error ? error.message : String(error),
        });

        if (attempt === this.maxAttempts) {
          throw new FraudTrustProviderError(
            "VPN_PROXY_DETECTION",
            PROVIDER_NAME,
            isAbort ? `IPQS request timed out after ${this.timeoutMs}ms.` : "IPQS request failed due to a network error.",
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

    throw new FraudTrustProviderError("VPN_PROXY_DETECTION", PROVIDER_NAME, "IPQS request failed.", true, {
      cause: lastError,
    });
  }
}
