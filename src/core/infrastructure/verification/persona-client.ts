import { VerificationProviderError } from "@/domain/errors/domain-error";
import { computeBackoffDelayMs } from "@/infrastructure/jobs/backoff";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 59 — Professional Verification (Persona).
 *
 * Thin, dependency-free HTTP client for Persona's REST API
 * (https://docs.withpersona.com/reference), called with plain `fetch` —
 * the same deliberate "no vendor SDK for a small, well-documented REST
 * surface" choice `TwilioSmsSender` makes (infrastructure/sms/
 * twilio-sms-sender.ts), for the identical reason: this client calls
 * exactly two Persona resources (Inquiries, one-time verification links),
 * not enough surface to justify an entire SDK dependency tree.
 *
 * `PersonaVerificationProvider` (persona-verification-provider.ts) is the
 * only caller — this class knows nothing about `VerificationProvider`,
 * `ProfessionalVerification`, or any domain type; it only knows how to
 * make an authenticated, retried, timed-out, correlation-tagged HTTP call
 * to Persona and hand back a parsed JSON body or throw
 * `VerificationProviderError`.
 *
 * ## Retry policy
 * Retries only on network errors, timeouts, and 5xx responses (transient)
 * — never on 4xx (a malformed request retrying identically will never
 * succeed) except 429 (rate-limited, explicitly retryable). Delay between
 * attempts reuses `computeBackoffDelayMs` (infrastructure/jobs/backoff.ts)
 * with `{ type: "exponential", delay: 500, jitter: 0.2 }` — the same
 * calculation Module 45's background-job retries use, applied here
 * in-process (this call blocks until it resolves or exhausts attempts)
 * rather than by re-scheduling a queued job.
 *
 * ## Timeout
 * Every request is wrapped in `AbortController` with a per-call timeout
 * (`PERSONA_TIMEOUT_MS`, default 10s) — Persona being slow or unreachable
 * must never hang the request that triggered it indefinitely.
 *
 * ## Correlation IDs
 * Every call generates (or reuses a caller-supplied) correlation id,
 * logged via the shared `logger` and sent as Persona's own
 * `Persona-Request-Id` idempotency/tracing header, so a support
 * investigation can follow one professional's verification attempt across
 * this platform's logs and Persona's own dashboard.
 */
export interface PersonaClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests so retry backoff doesn't actually sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PersonaRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  correlationId?: string;
}

const DEFAULT_BASE_URL = "https://withpersona.com/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export class PersonaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: PersonaClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<T = unknown>(req: PersonaRequest): Promise<T> {
    const correlationId = req.correlationId ?? crypto.randomUUID();
    const url = `${this.baseUrl}${req.path}`;

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method: req.method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "Persona-Request-Id": correlationId,
          },
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          signal: controller.signal,
        });

        if (response.ok) {
          logger.info("persona_request_succeeded", {
            method: req.method,
            path: req.path,
            correlationId,
            attempt,
            status: response.status,
          });
          return (await response.status) === 204 ? (undefined as T) : ((await response.json()) as T);
        }

        const detail = await safeReadBody(response);
        const retryable = response.status === 429 || response.status >= 500;

        logger.warn("persona_request_failed", {
          method: req.method,
          path: req.path,
          correlationId,
          attempt,
          status: response.status,
          retryable,
        });

        if (!retryable || attempt === this.maxAttempts) {
          throw new VerificationProviderError(
            "PERSONA",
            `Persona API request failed (HTTP ${response.status}): ${detail}`,
            retryable,
          );
        }

        lastError = new VerificationProviderError(
          "PERSONA",
          `Persona API request failed (HTTP ${response.status}): ${detail}`,
          true,
        );
      } catch (error) {
        if (error instanceof VerificationProviderError) throw error;

        const isAbort = error instanceof Error && error.name === "AbortError";
        const retryable = true; // network error / timeout — always transient.

        logger.warn("persona_request_error", {
          method: req.method,
          path: req.path,
          correlationId,
          attempt,
          timedOut: isAbort,
          error: error instanceof Error ? error.message : String(error),
        });

        if (attempt === this.maxAttempts) {
          throw new VerificationProviderError(
            "PERSONA",
            isAbort
              ? `Persona API request timed out after ${this.timeoutMs}ms.`
              : "Persona API request failed due to a network error.",
            retryable,
            { cause: error },
          );
        }

        lastError = error;
      } finally {
        clearTimeout(timer);
      }

      const delay = computeBackoffDelayMs(attempt, { type: "exponential", delay: 500, jitter: 0.2 });
      await this.sleep(delay);
    }

    // Unreachable — the loop above always either returns or throws before
    // exhausting `maxAttempts`. Kept only so TypeScript sees every path
    // returns/throws.
    throw new VerificationProviderError("PERSONA", "Persona API request failed.", true, { cause: lastError });
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}
