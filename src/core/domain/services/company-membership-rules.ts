/**
 * Module 18 — Company Professional: pure, dependency-free business rules for
 * CompanyMember (role hierarchy, removal/ownership-transfer eligibility).
 * Every rule here is re-checked in the application layer's use cases —
 * never trusted from the client or enforced only in the UI.
 *
 * Membership state itself is represented the same way this codebase already
 * represents "joined/removed" elsewhere (Address/PortfolioItem's own
 * deletedAt convention) rather than introducing a redundant status enum:
 * PENDING = invitedAt set, joinedAt null; ACTIVE = joinedAt set, removedAt
 * null; REMOVED = removedAt set. See deriveMembershipStatus below.
 */

export const COMPANY_MEMBER_ROLE_VALUES = ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const;
export type CompanyMemberRoleValue = (typeof COMPANY_MEMBER_ROLE_VALUES)[number];

export type CompanyMembershipStatusValue = "PENDING" | "ACTIVE" | "REMOVED";

/** Derives the membership's logical status from its timestamps — see this
 *  file's own top doc comment for why there is no separate status column. */
export function deriveMembershipStatus(member: {
  joinedAt: Date | null;
  removedAt: Date | null;
}): CompanyMembershipStatusValue {
  if (member.removedAt) return "REMOVED";
  if (member.joinedAt) return "ACTIVE";
  return "PENDING";
}

/** Role rank, higher = more authority. Used only for comparisons within this
 *  file (e.g. "can X change Y's role") — never serialized or persisted. */
const ROLE_RANK: Record<CompanyMemberRoleValue, number> = {
  OWNER: 3,
  ADMIN: 2,
  MANAGER: 1,
  MEMBER: 0,
};

export function roleRank(role: CompanyMemberRoleValue): number {
  return ROLE_RANK[role];
}

/**
 * Permission matrix (see docs/MODULE_18_COMPANY_PROFESSIONAL.md for the full
 * table). Encoded as small pure predicates rather than a single "hasPermission"
 * blob so each rule stays independently testable and readable at the call
 * site.
 */

/** OWNER and ADMIN may edit the company profile; MANAGER/MEMBER may not. */
export function canManageCompanyProfile(role: CompanyMemberRoleValue): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** OWNER and ADMIN may invite new members. */
export function canInviteMembers(role: CompanyMemberRoleValue): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** OWNER and ADMIN may cancel a pending invitation. */
export function canCancelInvitation(role: CompanyMemberRoleValue): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Whether `actorRole` may change a member's role to `targetRole` on a member
 * whose current role is `currentTargetRole`:
 *   - OWNER can set anyone (except themself, see canRemoveMember/ownership
 *     transfer below) to ADMIN/MANAGER/MEMBER.
 *   - ADMIN can manage MANAGER/MEMBER only — never promote to ADMIN/OWNER,
 *     never touch another ADMIN or the OWNER.
 *   - MANAGER/MEMBER can never change roles.
 *   - Nobody can set a role to OWNER through this path — ownership only
 *     changes via TransferCompanyOwnershipUseCase (see
 *     canInitiateOwnershipTransfer below).
 */
export function canChangeMemberRole(
  actorRole: CompanyMemberRoleValue,
  currentTargetRole: CompanyMemberRoleValue,
  newRole: CompanyMemberRoleValue,
): boolean {
  if (newRole === "OWNER") return false;
  if (currentTargetRole === "OWNER") return false;
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") {
    return currentTargetRole !== "ADMIN" && newRole !== "ADMIN";
  }
  return false;
}

/**
 * Whether `actorRole` may remove a member currently holding `targetRole`.
 * The OWNER can never be removed this way (ownership must be transferred
 * first — see canInitiateOwnershipTransfer) regardless of who is asking,
 * including the owner themself.
 */
export function canRemoveMember(actorRole: CompanyMemberRoleValue, targetRole: CompanyMemberRoleValue): boolean {
  if (targetRole === "OWNER") return false;
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") return targetRole === "MANAGER" || targetRole === "MEMBER";
  return false;
}

/** Only the current OWNER may initiate an ownership transfer. */
export function canInitiateOwnershipTransfer(actorRole: CompanyMemberRoleValue): boolean {
  return actorRole === "OWNER";
}

/**
 * Module 28 — Workflow Completion (company disputes): whether `role` may
 * act on behalf of the company on an operational, job-level matter — today
 * exactly one thing: opening a Dispute over a Job the company performed
 * (see resolveJobActor's "company" branch and CreateDisputeUseCase). OWNER/
 * ADMIN/MANAGER may (the same tier that already manages company-profile-
 * level concerns per canManageCompanyProfile, plus MANAGER — a role this
 * codebase's own Module 18 doc describes as handling day-to-day job/
 * membership operations, distinct from ADMIN's company-profile-editing
 * authority); a plain MEMBER may work the job but may not open a dispute
 * on the company's behalf, mirroring how a solo professional's own
 * dispute-opening authority isn't delegated to anyone else either.
 */
export function canActOnBehalfOfCompanyJob(role: CompanyMemberRoleValue): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}

/** Ownership can only transfer to an existing, active (non-removed) member
 *  of the same company — never to an outside user id, and never to the
 *  current owner themself (a no-op transfer is rejected as a validation
 *  error, not silently accepted). */
export function isEligibleOwnershipTransferTarget(
  targetMembershipStatus: CompanyMembershipStatusValue,
  isCurrentOwner: boolean,
): boolean {
  return targetMembershipStatus === "ACTIVE" && !isCurrentOwner;
}
