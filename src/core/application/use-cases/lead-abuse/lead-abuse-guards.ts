import type { AntiAbuseService } from "@/application/services/anti-abuse-service";
import type { RateLimitPolicyName } from "@/application/ports/rate-limit-policies";
import type { EvaluateLeadAbuseUseCase, LeadAbuseTrigger } from "@/application/use-cases/lead-abuse/evaluate-lead-abuse.use-case";
import { AccountRestrictedError, RateLimitedError } from "@/domain/errors/domain-error";
import type { LeadAbuseControlRepository } from "@/domain/repositories/lead-abuse-control-repository";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import {
  eventSignalDedupeKey,
  isLeadAbuseUuid,
  LEAD_ABUSE_RULESET_VERSION,
  type LeadAbuseEventSignalType,
  type LeadAbuseMode,
  type LeadAbuseRestrictedAction,
} from "@/domain/services/lead-abuse-controls";
import { logger } from "@/infrastructure/observability/logger";

type Executable<R> = { execute(userId: string, leadId: string): Promise<R> };

/**
 * Retry-after hint (ms) carried by the generic retryable refusal. Deliberately short and fixed: it reveals nothing about the cause.
 */
export const LEAD_ABUSE_ENFORCEMENT_RETRY_AFTER_MS = 5_000;

/**
 * Module 156 — the shared runtime of the three guards.
 *
 * Failure policy (hardened after the M156 release-readiness audit):
 *  - ENFORCE: a restriction that was ESTABLISHED must not be bypassed by an outage. The block lookup and the per-user rate limiter
 *    are each tried, retried ONCE after `retryDelayMs`, and if enforcement still cannot be evaluated the protected action is REFUSED
 *    with the platform's existing generic, localized, retryable `RateLimitedError` (no cause, no infrastructure detail, no security
 *    event). Business outcomes are never retried or converted: a block in force is `AccountRestrictedError`, an exhausted budget is
 *    `RateLimitedError` from the limiter itself.
 *  - SHADOW / FLAG / OFF: the risk layer never refuses anything (`preflight` returns at once).
 *  - Recording and evaluation (`observe`, `recordEvent`) stay best-effort in every mode: they run AFTER the action or after a
 *    denial, never throw, and never change its outcome. In particular a failing store can never grant contact access or replace
 *    the original `LeadContactAccessDeniedError`.
 *
 * This is still a risk layer, not an authorization layer: ownership, verification and the M139/M155 contact rules are enforced by
 * the wrapped use cases and are never relaxed here.
 */
export class LeadAbuseRuntime {
  constructor(
    readonly mode: LeadAbuseMode,
    private readonly evaluate: Pick<EvaluateLeadAbuseUseCase, "execute">,
    private readonly control: Pick<LeadAbuseControlRepository, "findBlockInForce" | "recordSignal">,
    private readonly antiAbuse: Pick<AntiAbuseService, "enforceRateLimit"> | null,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly retryDelayMs: number = 25,
  ) {}

  /**
   * ENFORCE only: refuse while a block is in force, then spend one unit of the per-user budget. At most TWO attempts per
   * dependency; if the second also fails the action is refused with a generic retryable error.
   */
  async preflight(userId: unknown, action: LeadAbuseRestrictedAction, policy: RateLimitPolicyName): Promise<void> {
    if (this.mode !== "ENFORCE" || !isLeadAbuseUuid(userId)) return;
    const subject = userId.trim();

    const block = await this.withOneRetry("block_lookup", () => this.control.findBlockInForce(subject, action, this.now()));
    if (block !== null) throw new AccountRestrictedError();

    if (!this.antiAbuse) return;
    const antiAbuse = this.antiAbuse;
    await this.withOneRetry("rate_limit", () => antiAbuse.enforceRateLimit(policy, { userId: subject }, "RATE_LIMIT_TRIGGERED", { now: this.now() }));
  }

  /**
   * Runs `attempt`; on an INFRASTRUCTURE failure waits briefly and runs it once more. A `RateLimitedError` is a business outcome of
   * the limiter and is rethrown at once, untouched. A second failure is logged (class name only) and surfaces as the generic
   * retryable refusal.
   */
  private async withOneRetry<T>(dependency: string, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (first) {
      if (first instanceof RateLimitedError) throw first;
      this.logFailure(`${dependency}_failed`, first);
    }
    await this.sleep(this.retryDelayMs).catch(() => undefined);
    try {
      return await attempt();
    } catch (second) {
      if (second instanceof RateLimitedError) throw second;
      this.logFailure(`${dependency}_failed_after_retry`, second);
      throw new RateLimitedError(undefined, LEAD_ABUSE_ENFORCEMENT_RETRY_AFTER_MS);
    }
  }

  /** Evaluates the rules after the action. Never throws. */
  async observe(userId: unknown, trigger: LeadAbuseTrigger): Promise<void> {
    if (this.mode === "OFF" || !isLeadAbuseUuid(userId)) return;
    try {
      await this.evaluate.execute({ subjectUserId: userId.trim(), trigger });
    } catch (error) {
      this.logFailure("evaluation_failed", error);
    }
  }

  /** Records one raw event signal (deduplicated per user / lead / hour). Never throws. */
  async recordEvent(userId: unknown, leadId: unknown, type: LeadAbuseEventSignalType): Promise<void> {
    if (this.mode === "OFF" || !isLeadAbuseUuid(userId) || !isLeadAbuseUuid(leadId)) return;
    const at = this.now();
    try {
      await this.control.recordSignal({
        subjectUserId: userId.trim(),
        signalType: type,
        reliability: "HEURISTIC",
        severity: "LOW",
        ruleVersion: LEAD_ABUSE_RULESET_VERSION,
        dedupeKey: eventSignalDedupeKey(type, userId.trim(), leadId.trim(), at),
        targetLeadId: leadId.trim().toLowerCase(),
        observedCount: null,
        threshold: null,
        windowSeconds: null,
        occurredAt: at,
      });
    } catch (error) {
      this.logFailure("event_record_failed", error);
    }
  }

  private logFailure(event: string, error: unknown): void {
    logger.error(`lead_abuse.${event}`, { error: error instanceof Error ? error.name : "unknown" });
  }
}

/**
 * M124/M133 publication, wrapped. ENFORCE: block / rate limit before the call. After a SUCCESSFUL publication the rules are
 * evaluated. The wrapped use case is called with exactly the same arguments and its result / error is returned unchanged.
 */
export class LeadAbuseGuardedPublishLead<R> implements Executable<R> {
  constructor(
    private readonly inner: Executable<R>,
    private readonly runtime: LeadAbuseRuntime,
  ) {}

  async execute(userId: string, leadId: string): Promise<R> {
    await this.runtime.preflight(userId, "LEAD_PUBLICATION", "LEAD_PUBLISH_BY_USER");
    const result = await this.inner.execute(userId, leadId);
    await this.runtime.observe(userId, "PUBLICATION");
    return result;
  }
}

/**
 * M126/M135 purchase initiation, wrapped. ENFORCE: block / rate limit before the call. A rejection that the use case itself
 * defines as "you may not buy this" (`LeadNotPurchasableError`) is recorded as a raw probing event; success and that rejection both
 * trigger evaluation. Every error is rethrown unchanged — the guard never turns a refusal into an allow or the reverse.
 */
export class LeadAbuseGuardedInitiatePurchase<R> implements Executable<R> {
  constructor(
    private readonly inner: Executable<R>,
    private readonly runtime: LeadAbuseRuntime,
  ) {}

  async execute(userId: string, leadId: string): Promise<R> {
    await this.runtime.preflight(userId, "LEAD_PURCHASE_INITIATION", "LEAD_PURCHASE_INITIATE_BY_USER");
    try {
      const result = await this.inner.execute(userId, leadId);
      await this.runtime.observe(userId, "PURCHASE");
      return result;
    } catch (error) {
      if (error instanceof LeadNotPurchasableError) {
        await this.runtime.recordEvent(userId, leadId, "PURCHASE_REJECTED_EVENT");
        await this.runtime.observe(userId, "PURCHASE");
      }
      throw error;
    }
  }
}

/**
 * M138/M139 contact read, OBSERVED only. This wrapper has no refusal path of its own: it cannot deny, cannot allow, never reads
 * contact data, and a risk level is never consulted. It only watches the one error the wrapped use case throws for EVERY denial
 * (including M155 DISPUTED / REVOKED purchases), records the probing event, and rethrows that very error object.
 */
export class LeadAbuseObservedGetLeadContact<R> implements Executable<R> {
  constructor(
    private readonly inner: Executable<R>,
    private readonly runtime: LeadAbuseRuntime,
  ) {}

  async execute(userId: string, leadId: string): Promise<R> {
    try {
      return await this.inner.execute(userId, leadId);
    } catch (error) {
      if (error instanceof LeadContactAccessDeniedError) {
        await this.runtime.recordEvent(userId, leadId, "CONTACT_ACCESS_DENIED_EVENT");
        await this.runtime.observe(userId, "CONTACT");
      }
      throw error;
    }
  }
}
