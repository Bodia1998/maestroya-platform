/**
 * Admin Panel module (Module 16): pure, dependency-free business rules for
 * admin operations — same small-helper style as notification-rules.ts/
 * review-rules.ts/portfolio-rules.ts.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_MODERATION_REASON_LENGTH = 500;

export const USER_STATUS_VALUES = ["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "BANNED", "DEACTIVATED"] as const;
export type UserStatusValue = (typeof USER_STATUS_VALUES)[number];

export const SERVICE_REQUEST_STATUS_VALUES = [
  "DRAFT",
  "PUBLISHED",
  "QUOTED",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "DISPUTED",
] as const;

export const QUOTE_STATUS_VALUES = [
  "PENDING",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
] as const;

export const JOB_STATUS_VALUES = ["CREATED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

export const REVIEW_STATUS_VALUES = ["PENDING", "PUBLISHED", "FLAGGED", "REMOVED"] as const;

/** Statuses a user can be moved to by an admin suspend action. Deliberately
 *  a fixed subset (not the full UserStatus enum) — Admin Panel only ever
 *  performs a deliberate suspend/reactivate action, never sets
 *  PENDING_VERIFICATION or BANNED (BANNED is a heavier, deliberately
 *  out-of-scope escalation for this module — see docs). */
export function isSuspendableStatus(status: UserStatusValue): boolean {
  return status === "ACTIVE";
}

export function isReactivatableStatus(status: UserStatusValue): boolean {
  return status === "SUSPENDED" || status === "DEACTIVATED";
}

/** Normalizes an optional moderation reason: trims, collapses a
 *  whitespace-only/empty string to `null`. Same convention as
 *  normalizeOptionalText in notification-rules.ts. */
export function normalizeModerationReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
