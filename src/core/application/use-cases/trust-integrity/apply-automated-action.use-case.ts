import type { EventBus } from "@/application/ports/event-bus";
import type { TrustAutomatedActionRepository, TrustAutomatedActionTypeValue } from "@/domain/repositories/trust-automated-action-repository";
import type { AccountRestrictionRepository } from "@/domain/repositories/account-restriction-repository";
import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";
import { decideAutomatedAction, requiresPayoutHold, type ActionPolicyConfig } from "@/domain/services/trust-integrity-action-policy";
import { AccountRestricted } from "@/domain/events/account-restricted";
import { AccountSuspended } from "@/domain/events/account-suspended";

/**
 * Module 65 — Trust & Integrity System: requirement #15 — executes the
 * consequence `trust-integrity-action-policy.ts` decided on. This is the
 * ONLY place in the module that writes a `TrustAutomatedAction` row, so
 * every action — whichever detector triggered it — goes through the same
 * "decide, then apply, then announce" pipeline.
 *
 * ## Suspension enforcement is a documented limitation
 * `TEMPORARY_SUSPENSION`/`PERMANENT_SUSPENSION` are recorded on the
 * `TrustAutomatedAction` ledger and announced via `AccountSuspended`, but
 * this use case deliberately does NOT flip `User.status` itself —
 * `UserRepository` (Module 1) has no `updateStatus` method today, and
 * widening a foundational, widely-implemented interface is out of this
 * module's own scope (see docs/MODULE_65's "Future Integration Readiness"
 * section). A future module adds that method and a session-invalidation
 * subscriber to `AccountSuspended`; today, an admin reviewing an active
 * `PERMANENT_SUSPENSION`/`TEMPORARY_SUSPENSION` action enforces it
 * manually via the existing admin user-management surface.
 *
 * `TEMPORARY_RESTRICTION` additionally layers a Module 24
 * `AccountRestriction` (state `TEMPORARILY_BLOCKED`, reason `OTHER`) so
 * existing throttling/blocking enforcement that already reads
 * `AccountRestrictionRepository.findActiveForUser` picks it up immediately
 * — the one action narrow enough to reuse an existing, already-enforced
 * mechanism without waiting on new wiring.
 *
 * A `PAYMENT_ABUSE_DETECTED` reason additionally, always applies a
 * `PAYOUT_HOLD` alongside whatever tier-driven action was decided (see
 * `requiresPayoutHold`) — both are written and announced; the tier-driven
 * action is returned as `primaryActionId`/`primaryActionType`, the
 * defensive hold (if any) as `payoutHoldActionId`.
 */
export interface ApplyAutomatedActionInput {
  userId: string;
  riskScore: number;
  reason: TrustRiskEventReasonValue;
  detail: string;
  /** Minutes until the action auto-expires; omitted for
   *  `PERMANENT_SUSPENSION`/`MANUAL_REVIEW`, which are indefinite until an
   *  admin/appeal resolves them. */
  expiresInMinutes?: number;
  actionPolicyConfig?: ActionPolicyConfig;
}

export interface ApplyAutomatedActionResult {
  applied: boolean;
  primaryActionId: string | null;
  primaryActionType: TrustAutomatedActionTypeValue | null;
  payoutHoldActionId: string | null;
}

export class ApplyAutomatedActionUseCase {
  constructor(
    private readonly automatedActions: TrustAutomatedActionRepository,
    private readonly accountRestrictions: AccountRestrictionRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: ApplyAutomatedActionInput): Promise<ApplyAutomatedActionResult> {
    const priorActive = await this.automatedActions.countActiveForUser(input.userId);
    const decision = decideAutomatedAction(input.riskScore, priorActive, input.actionPolicyConfig);

    const payoutHold = requiresPayoutHold(input.reason) ? await this.applyOne(input, "PAYOUT_HOLD") : null;

    if (decision.action === null) {
      return {
        applied: payoutHold !== null,
        primaryActionId: null,
        primaryActionType: null,
        payoutHoldActionId: payoutHold?.id ?? null,
      };
    }

    const primary = await this.applyOne(input, decision.action);
    return {
      applied: true,
      primaryActionId: primary.id,
      primaryActionType: primary.type,
      payoutHoldActionId: payoutHold?.id ?? null,
    };
  }

  private async applyOne(input: ApplyAutomatedActionInput, type: TrustAutomatedActionTypeValue) {
    const expiresAt =
      type === "PERMANENT_SUSPENSION" || type === "MANUAL_REVIEW"
        ? null
        : new Date(Date.now() + (input.expiresInMinutes ?? 24 * 60) * 60_000);

    const created = await this.automatedActions.create({
      userId: input.userId,
      type,
      reason: input.reason,
      triggeringRiskScore: input.riskScore,
      detail: input.detail,
      expiresAt,
    });

    if (type === "TEMPORARY_RESTRICTION") {
      await this.accountRestrictions.create({
        userId: input.userId,
        state: "TEMPORARILY_BLOCKED",
        reason: "OTHER",
        notes: `Trust & Integrity System: ${input.detail}`,
        expiresAt: expiresAt ?? new Date(Date.now() + 24 * 60 * 60_000),
      });
    }

    if (type === "TEMPORARY_SUSPENSION" || type === "PERMANENT_SUSPENSION") {
      await this.eventBus.publish(new AccountSuspended(input.userId, created.id, type === "PERMANENT_SUSPENSION", expiresAt));
    } else {
      await this.eventBus.publish(new AccountRestricted(input.userId, created.id, type, expiresAt));
    }

    return created;
  }
}
