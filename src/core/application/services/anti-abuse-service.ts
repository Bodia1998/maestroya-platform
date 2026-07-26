import { AccountRestrictedError, RateLimitedError } from "@/domain/errors/domain-error";
import type {
  AccountRestrictionReason,
  AccountRestrictionRepository,
} from "@/domain/repositories/account-restriction-repository";
import type { RateLimitRepository } from "@/domain/repositories/rate-limit-repository";
import type { SecurityEventRepository, SecurityEventType } from "@/domain/repositories/security-event-repository";
import { isHardBlocked } from "@/domain/services/account-restriction-rules";
import { buildRateLimitKey } from "@/domain/services/security-key";
import { isDuplicateContent, isBelowMinimumInterval } from "@/domain/services/spam-detection";
import { RATE_LIMIT_POLICIES, type RateLimitPolicyName } from "@/application/ports/rate-limit-policies";

/**
 * Security & Anti-Abuse module (Module 24): the centralized anti-abuse
 * policy layer the spec asks for — "is this allowed / should it be
 * throttled / temporarily blocked / flagged / audited", usable from
 * Server Actions, API routes, and use cases alike.
 *
 * Depends only on domain repository *interfaces* (RateLimitRepository,
 * SecurityEventRepository, AccountRestrictionRepository) — no Prisma, no
 * Stripe, consistent with every other application-layer service in this
 * codebase. See application/use-cases/security/compose.ts for how this
 * gets wired to concrete (in-memory/Prisma) implementations.
 *
 * Every public method here either returns cleanly (allowed) or throws a
 * DomainError the caller's existing `fromDomainError()` Server Action
 * helper already knows how to translate into a safe, generic client-facing
 * message — no new error-handling convention needed at the call sites.
 */
export interface RateLimitIdentity {
  userId?: string | null;
  ipHash?: string | null;
  resource?: string | null;
}

export interface AutoRestrictOnBreach {
  reason: AccountRestrictionReason;
  durationMs: number;
}

export class AntiAbuseService {
  constructor(
    private readonly rateLimits: RateLimitRepository,
    private readonly securityEvents: SecurityEventRepository,
    private readonly restrictions: AccountRestrictionRepository,
  ) {}

  /**
   * Throws RateLimitedError if `identity` has exceeded `policyName`'s
   * budget. Records a RATE_LIMIT_TRIGGERED-family SecurityEvent
   * (`onBlockedEventType`) on every block, never on an allowed attempt
   * (an event per allowed request would make this log useless noise).
   *
   * `identity` is *only* used to build the rate-limit bucket key (see
   * `buildRateLimitKey`) — it intentionally has no side effect on any
   * user's account. For account-level escalation on a breach, see
   * `escalateToTemporaryBlock` below, called separately (and only when
   * the caller already knows which user — e.g. after a rate-limited login
   * attempt for an email that *is* a real account — see
   * infrastructure/auth/auth-config.ts).
   */
  async enforceRateLimit(
    policyName: RateLimitPolicyName,
    identity: RateLimitIdentity,
    onBlockedEventType: SecurityEventType,
    options?: { now?: Date },
  ): Promise<void> {
    const now = options?.now ?? new Date();
    const policy = RATE_LIMIT_POLICIES[policyName];
    const key = buildRateLimitKey(policyName, identity);
    const decision = await this.rateLimits.consume(key, policy.limit, policy.windowMs, now);

    if (decision.allowed) return;

    await this.securityEvents.record({
      type: onBlockedEventType,
      userId: identity.userId ?? null,
      ipHash: identity.ipHash ?? null,
      metadata: { policy: policyName },
    });

    throw new RateLimitedError(undefined, decision.retryAfterMs ?? policy.windowMs);
  }

  /**
   * Creates a short, auto-expiring TEMPORARILY_BLOCKED AccountRestriction
   * for `userId` (`createdByUserId` left null — system-created, never a
   * permanent decision; see account-restriction-repository.ts's "no
   * permanent auto-bans" rule) and records the matching
   * ACCOUNT_TEMPORARILY_BLOCKED SecurityEvent. Called explicitly by a
   * caller that already knows the breach is tied to a real account — e.g.
   * auth-config.ts, after a LOGIN_BY_EMAIL rate-limit breach for an email
   * that resolves to an existing user — so five failed logins in fifteen
   * minutes escalate to "briefly locked out even once the rate-limit
   * window itself would reset".
   */
  async escalateToTemporaryBlock(userId: string, breach: AutoRestrictOnBreach, now: Date = new Date()): Promise<void> {
    await this.restrictions.create({
      userId,
      state: "TEMPORARILY_BLOCKED",
      reason: breach.reason,
      notes: "Auto-created after repeated rate-limit breaches.",
      createdByUserId: null,
      expiresAt: new Date(now.getTime() + breach.durationMs),
    });
    await this.securityEvents.record({
      type: "ACCOUNT_TEMPORARILY_BLOCKED",
      userId,
      metadata: { reason: breach.reason },
    });
  }

  /** Throws AccountRestrictedError if `userId` currently has an active
   *  TEMPORARILY_BLOCKED restriction. THROTTLED/FLAGGED are intentionally
   *  not hard-blocked here — see account-restriction-rules.ts's
   *  `isHardBlocked` doc comment. */
  async assertNotBlocked(userId: string, now: Date = new Date()): Promise<void> {
    const active = await this.restrictions.findActiveForUser(userId, now);
    if (isHardBlocked(active)) {
      throw new AccountRestrictedError();
    }
  }

  /** Thin, privacy-respecting pass-through to SecurityEventRepository —
   *  the one seam every caller in this module uses instead of importing a
   *  concrete repository directly, so a future change to what gets
   *  recorded (e.g. sampling) has a single place to change. */
  async recordEvent(params: Parameters<SecurityEventRepository["record"]>[0]): Promise<void> {
    await this.securityEvents.record(params);
  }

  /**
   * Duplicate-content spam guard. Returns a boolean rather than throwing —
   * duplicate content is a soft signal, not automatically fatal, so the
   * caller (a use case or Server Action) decides what to do with it
   * (reject with ConflictError, or just record a SUSPICIOUS_ACTIVITY_DETECTED
   * event and allow). See spam-detection.ts for the pure comparison logic
   * this wraps.
   */
  isDuplicateContent(candidate: string, recentContent: string[]): boolean {
    return isDuplicateContent(candidate, recentContent);
  }

  isBelowMinimumInterval(lastActionAt: Date | null, minIntervalMs: number, now: Date = new Date()): boolean {
    return isBelowMinimumInterval(lastActionAt, now, minIntervalMs);
  }
}
