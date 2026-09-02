import { StorageDeletionFailedError, UnresolvableStorageUrlError } from "@/infrastructure/storage/cloudinary/verification-document-deletion-service";

/**
 * Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion.
 *
 * Maps a raw Cloudinary SDK failure (or the network/adapter-level failure
 * wrapping it) into one of a small, closed set of categories the
 * application layer's retry policy (`gdpr-cloudinary-purge-policy.ts`)
 * reasons about. This is the infrastructure boundary rule 15 of the
 * module brief asks for: no Cloudinary SDK error shape, HTTP status code,
 * or raw provider payload crosses into `RetryPendingCloudinaryPurgesUseCase`
 * or `ExecuteAccountErasureUseCase` — only this category string plus a
 * short, redacted human-readable message do.
 *
 * Cloudinary's Node SDK rejects `uploader.destroy` with an object shaped
 * roughly `{ message: string, name: string, http_code: number }` for
 * provider-returned errors (auth/rate-limit/bad-request), and with a
 * plain `Error` (`ECONNRESET`/`ETIMEDOUT`/`ENOTFOUND`/etc., no
 * `http_code`) for a network-level failure before any response was
 * received. Both shapes are handled defensively — this function never
 * throws, and always returns something, even for a completely
 * unrecognized error shape (falls through to `UNKNOWN`).
 */
export type CloudinaryPurgeErrorCategory =
  | "NOT_FOUND"
  | "TRANSIENT"
  | "RATE_LIMITED"
  | "AUTHENTICATION"
  | "INVALID_REQUEST"
  | "UNKNOWN";

/**
 * Categories that must never be retried on a backoff schedule — the next
 * attempt would fail identically (bad credentials, a malformed/
 * unresolvable request), so `RetryPendingCloudinaryPurgesUseCase` and the
 * inline attempt inside `ExecuteAccountErasureUseCase` move a document
 * straight to `DEAD_LETTER` the first time one of these is classified,
 * rather than spending `GDPR_CLOUDINARY_PURGE_MAX_ATTEMPTS` attempts
 * re-confirming the same permanent failure (module brief rule 5: "Do not
 * blindly retry permanent errors forever").
 */
export const PERMANENT_PURGE_ERROR_CATEGORIES: ReadonlySet<CloudinaryPurgeErrorCategory> = new Set([
  "AUTHENTICATION",
  "INVALID_REQUEST",
]);

interface ClassifiableError {
  http_code?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
}

function asClassifiable(error: unknown): ClassifiableError {
  if (error && typeof error === "object") return error as ClassifiableError;
  return {};
}

/**
 * Classifies the *cause* of a `StorageDeletionFailedError` (its `.cause`,
 * the raw error `CloudinaryVerificationDocumentDeletionService` caught) —
 * never called with an `UnresolvableStorageUrlError`, which is already
 * unambiguously classified `INVALID_REQUEST` by its call site (a `fileUrl`
 * that cannot be resolved into a Cloudinary `public_id` will never resolve
 * on a later attempt either — retrying it is never useful).
 */
/**
 * Convenience entry point for `ExecuteAccountErasureUseCase` and
 * `RetryPendingCloudinaryPurgesUseCase`, which only ever see whatever
 * `VerificationDocumentStorageDeleter.deleteByUrl` throws — one of the two
 * typed errors that adapter defines, never a raw Cloudinary SDK error
 * directly. `UnresolvableStorageUrlError` is unambiguously `INVALID_REQUEST`
 * (see that error's own doc comment: no retry will ever resolve a `fileUrl`
 * that doesn't match the upload convention); `StorageDeletionFailedError`
 * delegates to `classifyCloudinaryPurgeError` on its wrapped `.cause`.
 */
export function classifyStorageDeletionError(error: unknown): CloudinaryPurgeErrorCategory {
  if (error instanceof UnresolvableStorageUrlError) return "INVALID_REQUEST";
  if (error instanceof StorageDeletionFailedError) return classifyCloudinaryPurgeError(error.cause);
  return classifyCloudinaryPurgeError(error);
}

export function classifyCloudinaryPurgeError(error: unknown): CloudinaryPurgeErrorCategory {
  const err = asClassifiable(error);

  const httpCode = typeof err.http_code === "number" ? err.http_code : undefined;
  if (httpCode !== undefined) {
    if (httpCode === 401 || httpCode === 403) return "AUTHENTICATION";
    if (httpCode === 420 || httpCode === 429) return "RATE_LIMITED";
    if (httpCode === 404) return "NOT_FOUND";
    if (httpCode >= 400 && httpCode < 500) return "INVALID_REQUEST";
    if (httpCode >= 500) return "TRANSIENT";
  }

  const code = typeof err.code === "string" ? err.code : undefined;
  if (code && ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"].includes(code)) {
    return "TRANSIENT";
  }

  const message = typeof err.message === "string" ? err.message.toLowerCase() : "";
  if (message.includes("rate limit") || message.includes("too many requests")) return "RATE_LIMITED";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("network")) {
    return "TRANSIENT";
  }
  if (message.includes("unauthorized") || message.includes("invalid signature") || message.includes("api key")) {
    return "AUTHENTICATION";
  }

  return "UNKNOWN";
}

/**
 * A short, redacted, log/storage-safe description of a purge failure —
 * never the raw error object (which could carry request headers or other
 * provider-internal detail), never the full `fileUrl` (a private,
 * personal-document reference — see `VerificationDocumentRecord`'s own
 * sensitive-data note). Callers persist this in
 * `storagePurgeLastError`/pass it to the logger's `errorCategory`/
 * `documentId` fields, never the raw error.
 */
export function describeCloudinaryPurgeError(category: CloudinaryPurgeErrorCategory, error: unknown): string {
  const err = asClassifiable(error);
  const rawMessage = typeof err.message === "string" ? err.message : String(error);
  // Bounded, and stripped of anything that looks like a URL (which could
  // embed the private, signed delivery path) — belt-and-braces on top of
  // the category-based classification above.
  const safeMessage = rawMessage.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 300);
  return `${category}: ${safeMessage}`;
}
