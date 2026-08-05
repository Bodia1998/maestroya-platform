/**
 * Notifications module (Module 15): pure, dependency-free business rules
 * for the Notification aggregate — same small-helper style as
 * review-rules.ts/portfolio-rules.ts, kept independently unit-testable
 * with exactly one definition rather than scattered `if` checks across use
 * cases.
 */

export const MAX_TITLE_LENGTH = 200;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_RESOURCE_TYPE_LENGTH = 50;
export const MAX_RESOURCE_ID_LENGTH = 100;
export const MAX_ACTION_URL_LENGTH = 500;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** A title is required, non-empty after trimming, and bounded. Mirrors the
 *  DTO boundary check (see notification.dto.ts) — checked again here so
 *  the rule holds even for callers that go straight through the use case,
 *  bypassing the DTO (as every integration test in this codebase does). */
export function isValidTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TITLE_LENGTH;
}

/** A message is required, non-empty after trimming, and bounded. */
export function isValidMessage(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_MESSAGE_LENGTH;
}

export function isValidResourceType(resourceType: string | null): boolean {
  if (resourceType === null) return true;
  const trimmed = resourceType.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_RESOURCE_TYPE_LENGTH;
}

export function isValidResourceId(resourceId: string | null): boolean {
  if (resourceId === null) return true;
  const trimmed = resourceId.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_RESOURCE_ID_LENGTH;
}

/**
 * `actionUrl` must be a safe, internal-only path — never an absolute/
 * external URL, and never a dangerous scheme (javascript:/data:/vbscript:,
 * or any other `scheme:` at all, since a legitimate in-app deep link is
 * always a relative path). Rejects protocol-relative paths ("//evil.com")
 * too, since browsers treat those as absolute. This is deliberately
 * stricter than portfolio-rules.ts's isValidMediaUrl (which requires
 * http(s) because it points *off*-platform, at Cloudinary) — this field
 * points *within* the app, so anything other than a same-origin relative
 * path is out of scope by construction.
 */
export function isSafeActionUrl(url: string | null): boolean {
  if (url === null) return true;
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ACTION_URL_LENGTH) return false;
  if (!trimmed.startsWith("/")) return false;
  // Rejects protocol-relative paths ("//evil.com") and the equivalent
  // backslash form ("/\evil.com") — several browsers normalize a leading
  // backslash to a forward slash, so "/\evil.com" is parsed identically to
  // "//evil.com" (an absolute, off-origin URL) despite starting with a
  // single "/". Module 33 — Security Hardening: same check already applied
  // to the post-login `callbackUrl` guard (resolve-post-login-destination.ts)
  // for the identical reason.
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return false;
  // Defense in depth against encoded/whitespace-obfuscated dangerous
  // schemes appearing anywhere in the string (e.g. "/x\njavascript:...").
  const lowered = trimmed.toLowerCase();
  if (/(javascript|data|vbscript):/i.test(lowered)) return false;
  return true;
}

/** Normalizes an optional free-text field: trims, and collapses a
 *  whitespace-only/empty string to `null`. Same convention as
 *  normalizeComment in review-rules.ts / normalizeOptionalText in
 *  portfolio-rules.ts. */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
