/**
 * Security & Anti-Abuse module (Module 24): append-only security event
 * log — kept as its own table/repository rather than reusing
 * AdminAuditLogRepository's AuditLog table. See schema.prisma's
 * SecurityEvent doc comment for why: most of these events (a failed
 * login, a rate-limit trip from an anonymous IP) have no authenticated
 * actor and no single target entity, which AuditLog's shape assumes.
 *
 * Deliberately append-only: no update/delete method exists on this
 * interface, same reasoning as AdminAuditLogRepository.
 *
 * Read access (`list`) is for admin/investigation use only — the Server
 * Action or use case calling `list` must itself have already gated on
 * `requireRole(SUPER_ADMIN)` (see use-cases/security/list-security-events.use-case.ts).
 * This repository has no notion of "who's asking" and enforces nothing
 * itself, exactly like every other *Repository interface in this codebase.
 */
export type SecurityEventType =
  | "LOGIN_FAILED"
  | "LOGIN_SUCCEEDED"
  | "ACCOUNT_CREATED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED"
  | "EMAIL_VERIFICATION_REQUESTED"
  | "RATE_LIMIT_TRIGGERED"
  | "ACCOUNT_TEMPORARILY_BLOCKED"
  | "SUSPICIOUS_ACTIVITY_DETECTED"
  | "SERVICE_REQUEST_RATE_LIMITED"
  | "QUOTE_RATE_LIMITED"
  | "MESSAGE_RATE_LIMITED"
  | "REVIEW_RATE_LIMITED"
  | "ADMIN_ACTION"
  | "SECURITY_POLICY_BLOCKED";

export interface RecordSecurityEventData {
  type: SecurityEventType;
  /** Null for anonymous/pre-auth events (e.g. a failed login for an
   *  unknown email, a registration-flood from one IP). */
  userId?: string | null;
  /**
   * Pre-hashed by the caller (see domain/services/security-key.ts's
   * `hashIp`) — this repository/table never receives or stores a raw IP
   * address. Never re-derive or reverse this value; it exists only to
   * recognise "same source acted again", not to identify a location.
   */
  ipHash?: string | null;
  /** Stored verbatim, but the caller is expected to have already
   *  truncated it (see security-key.ts's `truncateUserAgent`). */
  userAgent?: string | null;
  /**
   * Free-form context (e.g. `{ policy: "LOGIN", attempt: 4 }`). Must never
   * contain a password, token, full email+password pair, payment
   * credential, or raw IP — this is an append-only table nothing ever
   * scrubs.
   */
  metadata?: Record<string, unknown> | null;
}

export interface SecurityEventRecord {
  id: string;
  type: SecurityEventType;
  userId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ListSecurityEventsOptions {
  type?: SecurityEventType;
  userId?: string;
  limit: number;
  offset: number;
}

export interface SecurityEventRepository {
  record(data: RecordSecurityEventData): Promise<SecurityEventRecord>;
  /** Newest first, admin-only, paginated — see AdminAuditLogRepository.list
   *  for the identical `createdAt desc, id desc` tie-break convention. */
  list(options: ListSecurityEventsOptions): Promise<SecurityEventRecord[]>;
}
