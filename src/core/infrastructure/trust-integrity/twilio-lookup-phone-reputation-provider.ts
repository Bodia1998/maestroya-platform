import { FraudTrustProviderError } from "@/domain/errors/domain-error";
import { computeBackoffDelayMs } from "@/infrastructure/jobs/backoff";
import { logger } from "@/infrastructure/observability/logger";
import { maskPhoneForLogging } from "@/infrastructure/trust-integrity/phone-masking";
import type { PhoneLineType, PhoneReputationProvider, PhoneReputationResult } from "@/application/ports/phone-reputation-provider";

/**
 * Module 93 — Real Fraud & Trust Signal Providers: `PhoneReputationProvider`
 * backed by Twilio Lookup v2's `line_type_intelligence` package
 * (https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence).
 *
 * ## Why Twilio
 * This codebase already has a production Twilio account for SMS
 * (`TwilioSmsSender`, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` — Module
 * 49) — reusing those same credentials for Lookup needs zero new vendor
 * relationship, no new secret, and (per Module 65's original doc comment
 * candidate list) was the anticipated choice for this port. Numverify was
 * the other option Module 65's doc comment named; rejected because it
 * would be a second phone-data vendor purely for a lookup this platform's
 * existing SMS provider already offers, with the same auth this codebase
 * already manages.
 *
 * Called with plain `fetch` + HTTP Basic Auth, same deliberate
 * no-SDK choice `TwilioSmsSender` makes for the Messages API — Lookup v2
 * is exactly one endpoint.
 *
 * ## Endpoint and fields actually used
 * `GET https://lookups.twilio.com/v2/PhoneNumbers/{phoneE164}?Fields=line_type_intelligence`.
 * Only three response fields are read: `valid` (bool), `country_code`,
 * and `line_type_intelligence.type`/`line_type_intelligence.carrier_name`.
 * `validation_errors`, `national_format`, `caller_name`, and every other
 * package this endpoint could return are never requested (no other
 * `Fields` value is passed) and never read — this platform's fraud engine
 * has no use for a caller-ID lookup, and requesting it would be
 * unnecessary third-party personal data collection the module brief
 * explicitly prohibits.
 *
 * ## riskScore — MaestroYa's own heuristic, not a Twilio field
 * Twilio Lookup v2's `line_type_intelligence` package does not return a
 * fraud/risk score (that exists only on Twilio's separate, enterprise-only
 * Fraud Guard product, not integrated here — see the implementation
 * report's "Known limitations"). `riskScore` is this adapter's own
 * mapping: invalid number → 100; `type === "voip"` → 55 (VOIP numbers are
 * disproportionately used for disposable/burner registrations, but far
 * from proof of fraud on their own — kept moderate, not maximal);
 * anything else valid → 5. `lineType` maps Twilio's `type` values
 * (`mobile`, `landline`, `voip`, `personal`, `tollFree`, `premium`,
 * `sharedCost`, `uan`, `voicemail`, `pager`, `unknown`) down to this
 * port's closed `PhoneLineType` — `mobile`→MOBILE, `landline`→LANDLINE,
 * `voip`→VOIP, everything else→UNKNOWN (this platform's fraud rules have
 * no use for the finer Twilio-specific categories today).
 *
 * ## Timeout, retry, failure semantics
 * Same shape as `PersonaClient`/`IpqsVpnProxyDetectionProvider`:
 * `AbortController` timeout (`TWILIO_LOOKUP_TIMEOUT_MS`, default 5s),
 * exponential backoff on network errors/timeouts/5xx/429, never on other
 * 4xx (Twilio returns 404 for a well-formed-but-unassigned number — this
 * is a valid, non-retryable *answer* ("not a real number"), not a
 * failure, so 404 is handled as `valid: false` rather than thrown).
 *
 * ## Masked logging
 * Every log line here uses `maskPhoneForLogging(phoneE164)` — the full
 * E.164 number is never passed to `logger`, never included in the
 * outbound URL's logged form (only used to build the actual request URL,
 * which itself is never logged verbatim).
 */
export interface TwilioLookupPhoneReputationProviderOptions {
  accountSid: string;
  authToken: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface TwilioLookupResponse {
  valid: boolean | null;
  country_code?: string | null;
  line_type_intelligence?: {
    type?: string | null;
    carrier_name?: string | null;
  } | null;
}

const DEFAULT_BASE_URL = "https://lookups.twilio.com/v2/PhoneNumbers";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const PROVIDER_NAME = "TWILIO_LOOKUP";

function toLineType(type: string | null | undefined): PhoneLineType {
  switch (type) {
    case "mobile":
      return "MOBILE";
    case "landline":
      return "LANDLINE";
    case "voip":
      return "VOIP";
    default:
      return "UNKNOWN";
  }
}

function toRiskScore(valid: boolean, lineType: PhoneLineType): number {
  if (!valid) return 100;
  if (lineType === "VOIP") return 55;
  return 5;
}

export class TwilioLookupPhoneReputationProvider implements PhoneReputationProvider {
  readonly name = "TWILIO_LOOKUP";

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TwilioLookupPhoneReputationProviderOptions) {
    this.accountSid = options.accountSid;
    this.authToken = options.authToken;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async lookup(phoneE164: string): Promise<PhoneReputationResult> {
    const correlationId = crypto.randomUUID();
    const masked = maskPhoneForLogging(phoneE164);
    const url = `${this.baseUrl}/${encodeURIComponent(phoneE164)}?Fields=line_type_intelligence`;
    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = Date.now();

      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Basic ${credentials}` },
          signal: controller.signal,
        });
        const latencyMs = Date.now() - startedAt;

        // Twilio returns 404 for a syntactically valid but unassigned
        // number — a real, non-retryable answer, not a failure.
        if (response.status === 404) {
          logger.info("fraud_provider_call_succeeded", {
            provider: PROVIDER_NAME,
            operation: "lookup",
            correlationId,
            phone: masked,
            attempt,
            latencyMs,
            outcome: "not_found",
          });
          return {
            valid: false,
            lineType: "UNKNOWN",
            riskScore: 100,
            countryCode: null,
            carrierName: null,
            provider: PROVIDER_NAME,
            checkedAt: new Date(),
          };
        }

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          logger.warn("fraud_provider_call_failed", {
            provider: PROVIDER_NAME,
            operation: "lookup",
            correlationId,
            phone: masked,
            attempt,
            latencyMs,
            status: response.status,
            retryable,
          });
          if (!retryable || attempt === this.maxAttempts) {
            throw new FraudTrustProviderError(
              "PHONE_REPUTATION",
              PROVIDER_NAME,
              `Twilio Lookup request failed (HTTP ${response.status}).`,
              retryable,
            );
          }
          lastError = new Error(`HTTP ${response.status}`);
          clearTimeout(timer);
          await this.sleep(computeBackoffDelayMs(attempt, { type: "exponential", delay: 300, jitter: 0.2 }));
          continue;
        }

        const body = (await response.json()) as TwilioLookupResponse;
        if (typeof body.valid !== "boolean") {
          logger.warn("fraud_provider_malformed_response", {
            provider: PROVIDER_NAME,
            operation: "lookup",
            correlationId,
            phone: masked,
            latencyMs,
          });
          throw new FraudTrustProviderError(
            "PHONE_REPUTATION",
            PROVIDER_NAME,
            "Twilio Lookup returned a malformed response.",
            false,
          );
        }

        const lineType = toLineType(body.line_type_intelligence?.type);

        logger.info("fraud_provider_call_succeeded", {
          provider: PROVIDER_NAME,
          operation: "lookup",
          correlationId,
          phone: masked,
          attempt,
          latencyMs,
        });

        return {
          valid: body.valid,
          lineType,
          riskScore: toRiskScore(body.valid, lineType),
          countryCode: body.country_code ?? null,
          carrierName: body.line_type_intelligence?.carrier_name ?? null,
          provider: PROVIDER_NAME,
          checkedAt: new Date(),
        };
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof FraudTrustProviderError) throw error;

        const isAbort = error instanceof Error && error.name === "AbortError";
        logger.warn("fraud_provider_call_error", {
          provider: PROVIDER_NAME,
          operation: "lookup",
          correlationId,
          phone: masked,
          attempt,
          timedOut: isAbort,
          error: error instanceof Error ? error.message : String(error),
        });

        if (attempt === this.maxAttempts) {
          throw new FraudTrustProviderError(
            "PHONE_REPUTATION",
            PROVIDER_NAME,
            isAbort
              ? `Twilio Lookup request timed out after ${this.timeoutMs}ms.`
              : "Twilio Lookup request failed due to a network error.",
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

    throw new FraudTrustProviderError("PHONE_REPUTATION", PROVIDER_NAME, "Twilio Lookup request failed.", true, {
      cause: lastError,
    });
  }
}
