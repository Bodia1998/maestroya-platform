/**
 * Request correlation ID (Module 25 — Production Infrastructure).
 *
 * Framework-agnostic on purpose (no `next/server`/`next/headers` import
 * here) so it can be unit-tested without a request/response object and
 * reused from both `middleware.ts` (edge runtime) and any future
 * non-middleware caller.
 */

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Matches the shape produced by `crypto.randomUUID()` (v4 UUID). Incoming
 * client-supplied request IDs are only ever reused if they match this —
 * anything else (empty, wrong length, containing control characters, an
 * attempt to smuggle something else through a log-aggregated field) is
 * discarded and replaced with a freshly generated one instead. This is a
 * deliberate trust boundary: an upstream trusted proxy/load balancer that
 * already generated a correlation ID gets it preserved end-to-end, but an
 * arbitrary unauthenticated client cannot inject arbitrary content into
 * this codebase's structured logs via this header.
 */
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRequestId(value: string | null | undefined): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Given an incoming header value, returns a trustworthy request ID: the
 * incoming value itself if it's already a valid UUID (so a request ID
 * assigned upstream, e.g. by a load balancer or API gateway, is
 * preserved end-to-end through this app's own logs), otherwise a freshly
 * generated one.
 */
export function resolveRequestId(incomingHeaderValue: string | null | undefined): string {
  return isValidRequestId(incomingHeaderValue) ? incomingHeaderValue : generateRequestId();
}
