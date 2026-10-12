import type { AdminRepository, AdminUserRecord } from "@/domain/repositories/admin-repository";
import type { LeadAbuseControlRepository, LeadAbuseDecisionRecord } from "@/domain/repositories/lead-abuse-control-repository";
import {
  LEAD_ABUSE_ADMIN_ACTIVE_STATUS,
  LEAD_ABUSE_ADMIN_ROLES,
  LeadAbuseControlRejectedError,
  isLeadAbuseRestrictedAction,
  isLeadAbuseUuid,
  normalizeAdminBlockDurationMs,
  normalizeLeadAbuseNote,
  type LeadAbuseRestrictedAction,
} from "@/domain/services/lead-abuse-controls";

/**
 * Module 156 — administrative decisions. The actor is RE-READ through the existing `AdminRepository.getUserById` on every call: it
 * must exist, be ACTIVE and hold ADMIN or SUPER_ADMIN; a repository failure rejects (fail closed); a caller-supplied role is never
 * trusted. An administrator can never act on their OWN account (separation of duties): the refusal is the same generic
 * ACTOR_NOT_AUTHORIZED, so it reveals nothing. Ordinary users have no path to any of these classes.
 *
 * None of these decisions is financial: they restrict one named action (or resolve a review flag) and are fully reversible by
 * `LiftLeadAbuseDecisionUseCase`. Strong restrictions exist ONLY here — the automated layer can flag and briefly block bursts, never more.
 */
export async function assertAuthorizedLeadAbuseAdmin(admins: Pick<AdminRepository, "getUserById">, actorUserId: unknown): Promise<string> {
  if (typeof actorUserId !== "string" || actorUserId.trim() === "") throw new LeadAbuseControlRejectedError("ACTOR_NOT_AUTHORIZED");
  const id = actorUserId.trim();
  let actor: AdminUserRecord | null;
  try {
    actor = await admins.getUserById(id);
  } catch {
    throw new LeadAbuseControlRejectedError("ACTOR_NOT_AUTHORIZED");
  }
  const allowed = LEAD_ABUSE_ADMIN_ROLES as readonly string[];
  if (!actor || actor.status !== LEAD_ABUSE_ADMIN_ACTIVE_STATUS || !Array.isArray(actor.roles) || !actor.roles.some((role) => allowed.includes(role))) {
    throw new LeadAbuseControlRejectedError("ACTOR_NOT_AUTHORIZED");
  }
  return id;
}

export interface LeadAbuseDecisionDTO {
  id: string;
  subjectUserId: string;
  action: LeadAbuseDecisionRecord["action"];
  restrictedAction: LeadAbuseDecisionRecord["restrictedAction"];
  status: LeadAbuseDecisionRecord["status"];
  origin: LeadAbuseDecisionRecord["origin"];
  ruleKey: LeadAbuseDecisionRecord["ruleKey"];
  decidedAt: Date;
  expiresAt: Date | null;
  liftedAt: Date | null;
}

export function toLeadAbuseDecisionDto(record: LeadAbuseDecisionRecord): LeadAbuseDecisionDTO {
  return {
    id: record.id,
    subjectUserId: record.subjectUserId,
    action: record.action,
    restrictedAction: record.restrictedAction,
    status: record.status,
    origin: record.origin,
    ruleKey: record.ruleKey,
    decidedAt: record.decidedAt,
    expiresAt: record.expiresAt,
    liftedAt: record.liftedAt,
  };
}

export interface ImposeLeadAbuseBlockInput {
  subjectUserId: string;
  restrictedAction: LeadAbuseRestrictedAction;
  /** Whole milliseconds, 30 minutes .. 30 days. There is no permanent block. */
  durationMs: number;
  explanation: string;
}

/** An administrator temporarily blocks ONE action for ONE account. Takes effect only while the rollout mode is ENFORCE. */
export class ImposeLeadAbuseBlockUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly control: Pick<LeadAbuseControlRepository, "imposeAdminBlock">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actorUserId: string, input: ImposeLeadAbuseBlockInput): Promise<LeadAbuseDecisionDTO> {
    // Pure validation, then the actor (re-read), then the subject, then state.
    if (!isLeadAbuseRestrictedAction(input?.restrictedAction) || !isLeadAbuseUuid(input?.subjectUserId)) throw new LeadAbuseControlRejectedError("INVALID_INPUT");
    const durationMs = normalizeAdminBlockDurationMs(input.durationMs);
    const explanation = normalizeLeadAbuseNote(input.explanation);
    const actorId = await assertAuthorizedLeadAbuseAdmin(this.admins, actorUserId);
    const subjectUserId = input.subjectUserId.trim();
    if (subjectUserId.toLowerCase() === actorId.toLowerCase()) throw new LeadAbuseControlRejectedError("ACTOR_NOT_AUTHORIZED");

    let subject: AdminUserRecord | null;
    try {
      subject = await this.admins.getUserById(subjectUserId);
    } catch {
      throw new LeadAbuseControlRejectedError("SUBJECT_NOT_FOUND");
    }
    if (!subject) throw new LeadAbuseControlRejectedError("SUBJECT_NOT_FOUND");

    const at = this.now();
    const outcome = await this.control.imposeAdminBlock({
      subjectUserId,
      restrictedAction: input.restrictedAction,
      actorUserId: actorId,
      explanation,
      decidedAt: at,
      expiresAt: new Date(at.getTime() + durationMs),
    });
    // A block of this action is already in force (a concurrent or earlier decision): nothing was created, so say so.
    if (!outcome.created) throw new LeadAbuseControlRejectedError("INVALID_STATE");
    return toLeadAbuseDecisionDto(outcome.decision);
  }
}

/** An administrator lifts a block or resolves a review flag, with a mandatory note. Exactly one of several racing lifts succeeds. */
export class LiftLeadAbuseDecisionUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly control: Pick<LeadAbuseControlRepository, "findDecisionById" | "lift">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actorUserId: string, input: { decisionId: string; note: string }): Promise<LeadAbuseDecisionDTO> {
    const note = normalizeLeadAbuseNote(input?.note);
    const actorId = await assertAuthorizedLeadAbuseAdmin(this.admins, actorUserId);
    if (!isLeadAbuseUuid(input.decisionId)) throw new LeadAbuseControlRejectedError("DECISION_NOT_FOUND");

    const current = await this.control.findDecisionById(input.decisionId.trim());
    if (!current) throw new LeadAbuseControlRejectedError("DECISION_NOT_FOUND");
    // Separation of duties, before any state answer: an administrator never clears a restriction or flag on their own account.
    if (current.subjectUserId.toLowerCase() === actorId.toLowerCase()) throw new LeadAbuseControlRejectedError("ACTOR_NOT_AUTHORIZED");
    if (current.status !== "ACTIVE") throw new LeadAbuseControlRejectedError("INVALID_STATE");

    const lifted = await this.control.lift(current.id, actorId, note, this.now());
    if (!lifted) throw new LeadAbuseControlRejectedError("INVALID_STATE"); // a concurrent lift won
    return toLeadAbuseDecisionDto(lifted);
  }
}

/** The review queue: open FLAG_FOR_REVIEW decisions, oldest first. Administrator only. */
export class ListOpenLeadAbuseFlagsUseCase {
  constructor(
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly control: Pick<LeadAbuseControlRepository, "listOpenFlags">,
  ) {}

  async execute(actorUserId: string, limit = 50): Promise<LeadAbuseDecisionDTO[]> {
    await assertAuthorizedLeadAbuseAdmin(this.admins, actorUserId);
    const bounded = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
    return (await this.control.listOpenFlags(bounded)).map(toLeadAbuseDecisionDto);
  }
}
