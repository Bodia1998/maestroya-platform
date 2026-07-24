/**
 * Portfolio module (Module 14): pure, dependency-free business rules for
 * the PortfolioItem aggregate — same small-helper style as
 * review-rules.ts/quote-state.ts, kept independently unit-testable and
 * with exactly one definition rather than scattered `if` checks across use
 * cases.
 */

export const MIN_TITLE_LENGTH = 3;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;

/** 3–120 characters after trimming. Mirrors the DTO boundary check (see
 *  portfolio.dto.ts) — checked again here so the rule holds even for
 *  callers that go straight through the use case, bypassing the DTO (as
 *  every integration test in this codebase does). */
export function isValidTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length >= MIN_TITLE_LENGTH && trimmed.length <= MAX_TITLE_LENGTH;
}

/** A description is optional, but if present it must not exceed
 *  MAX_DESCRIPTION_LENGTH after trimming. */
export function isValidDescription(description: string | null): boolean {
  if (description === null) return true;
  return description.trim().length <= MAX_DESCRIPTION_LENGTH;
}

/**
 * Normalizes an optional free-text field: trims, and collapses a
 * whitespace-only/empty string to `null`. Same convention as
 * normalizeComment in review-rules.ts.
 */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Media URL must be http(s) — the only scheme the platform's own upload
 * pipeline (Cloudinary) and any manually-entered link can plausibly
 * produce. Rejects `javascript:`/`data:`/relative paths, mirroring the
 * intent (if not the exact library) of professional.dto.ts's
 * `websiteUrl` check.
 */
export function isValidMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
