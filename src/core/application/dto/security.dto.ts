import { z } from "zod";

import type { AccountRestrictionRecord } from "@/domain/repositories/account-restriction-repository";
import type { SecurityEventRecord } from "@/domain/repositories/security-event-repository";

/**
 * Security & Anti-Abuse module (Module 24): admin-facing read shapes.
 *
 * `ipHash` is intentionally omitted from `AdminSecurityEventView` even
 * though an admin is allowed to see this data — it is a one-way,
 * pre-hashed value with no legitimate admin use (it cannot be turned back
 * into an IP, and the raw IP was never stored in the first place; see
 * SecurityEvent's doc comment in schema.prisma). Excluding it here also
 * means no future presentation-layer code can accidentally start
 * rendering it. Internal detection thresholds, fraud rule internals, and
 * investigation notes on AccountRestriction (`notes`) are for admin eyes
 * only and are exactly what these DTOs expose — never to the affected
 * user (see profile/account Server Actions, none of which read from
 * these repositories).
 */
export interface AdminSecurityEventView {
  id: string;
  type: string;
  userId: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export function toAdminSecurityEventView(record: SecurityEventRecord): AdminSecurityEventView {
  return {
    id: record.id,
    type: record.type,
    userId: record.userId,
    userAgent: record.userAgent,
    metadata: record.metadata,
    createdAt: record.createdAt,
  };
}

export interface AdminAccountRestrictionView {
  id: string;
  userId: string;
  state: string;
  reason: string;
  notes: string | null;
  createdByUserId: string | null;
  expiresAt: Date | null;
  liftedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toAdminAccountRestrictionView(record: AccountRestrictionRecord): AdminAccountRestrictionView {
  return { ...record };
}

const securityEventTypeSchema = z.enum([
  "LOGIN_FAILED",
  "LOGIN_SUCCEEDED",
  "ACCOUNT_CREATED",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_COMPLETED",
  "EMAIL_VERIFICATION_REQUESTED",
  "RATE_LIMIT_TRIGGERED",
  "ACCOUNT_TEMPORARILY_BLOCKED",
  "SUSPICIOUS_ACTIVITY_DETECTED",
  "SERVICE_REQUEST_RATE_LIMITED",
  "QUOTE_RATE_LIMITED",
  "MESSAGE_RATE_LIMITED",
  "REVIEW_RATE_LIMITED",
  "ADMIN_ACTION",
  "SECURITY_POLICY_BLOCKED",
]);

export const listSecurityEventsSchema = z.object({
  type: securityEventTypeSchema.optional(),
  userId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export type ListSecurityEventsInput = z.infer<typeof listSecurityEventsSchema>;

export const createAccountRestrictionSchema = z.object({
  userId: z.string().uuid(),
  state: z.enum(["THROTTLED", "TEMPORARILY_BLOCKED", "FLAGGED"]),
  reason: z.enum([
    "FAILED_LOGIN_BURST",
    "REGISTRATION_ABUSE",
    "SERVICE_REQUEST_SPAM",
    "QUOTE_SPAM",
    "MESSAGE_SPAM",
    "REVIEW_ABUSE",
    "ADMIN_DECISION",
    "OTHER",
  ]),
  notes: z.string().trim().max(1000).optional(),
  /** Minutes until this restriction auto-expires, or omitted for an
   *  explicit indefinite admin decision (only allowed here — the
   *  automated AntiAbuseService path always supplies a duration). */
  durationMinutes: z.number().int().positive().max(60 * 24 * 30).optional(),
});
export type CreateAccountRestrictionInput = z.infer<typeof createAccountRestrictionSchema>;
