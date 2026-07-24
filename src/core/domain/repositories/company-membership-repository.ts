import type { CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";

/**
 * Module 18 — Company Professional: repository interface for CompanyMember.
 * Kept separate from CompanyRepository (same "one repository per aggregate"
 * convention as e.g. QuoteRepository vs QuoteItem being embedded in it) since
 * membership has its own access patterns (per-user "which companies am I in",
 * per-company "who works here") independent of the company's own fields.
 */

export interface CompanyMemberRecord {
  id: string;
  companyId: string;
  userId: string;
  role: CompanyMemberRoleValue;
  invitedAt: Date;
  joinedAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A member row joined with the minimal user-identification fields the
 *  members list / admin detail view needs — never includes passwordHash or
 *  any token. */
export interface CompanyMemberWithUser extends CompanyMemberRecord {
  userName: string | null;
  userEmail: string | null;
}

export interface CompanyMembershipRepository {
  findById(id: string): Promise<CompanyMemberRecord | null>;
  /** The caller's own membership row in a given company, or null if they've
   *  never been a member of it. Includes removed rows — callers that care
   *  about "currently active" must check `removedAt`/`deriveMembershipStatus`
   *  themselves (this mirrors `findByUserId` elsewhere returning the full
   *  record, not a pre-filtered view). */
  findByCompanyAndUser(companyId: string, userId: string): Promise<CompanyMemberRecord | null>;
  /** Every company a user currently has an active (joined, not removed)
   *  membership in — a user may belong to more than one company. */
  listActiveCompaniesForUser(userId: string): Promise<CompanyMemberRecord[]>;
  /** Every member of a company, including pending invitees, joined with
   *  safe user fields, for the members-management page. */
  listByCompany(companyId: string): Promise<CompanyMemberWithUser[]>;
  /** The company's current OWNER row — every company has exactly one. */
  findOwner(companyId: string): Promise<CompanyMemberRecord | null>;
  countActiveMembers(companyId: string): Promise<number>;

  /** Creates the initial OWNER row at company-creation time. */
  createOwner(companyId: string, userId: string): Promise<CompanyMemberRecord>;
  /** Creates a joined (not pending) member row — used when an invitation is
   *  accepted. `joinedAt` is set to `now` at creation, matching the
   *  "accepted invitation ⇒ immediately active" business rule (there is no
   *  separate approval step after acceptance). */
  createFromAcceptedInvitation(
    companyId: string,
    userId: string,
    role: CompanyMemberRoleValue,
  ): Promise<CompanyMemberRecord>;

  updateRole(id: string, role: CompanyMemberRoleValue): Promise<CompanyMemberRecord>;
  /** Soft-removes a member (`removedAt`) — never a hard delete, preserving
   *  "who worked here and when" for dispute/audit purposes (same convention
   *  the schema's own doc comment describes). */
  remove(id: string, removedAt: Date): Promise<void>;

  /** Used only by TransferCompanyOwnershipUseCase, inside one transaction
   *  with CompanyRepository.updateOwner: demotes the outgoing owner to
   *  ADMIN and promotes the incoming owner to OWNER. */
  transferOwnership(companyId: string, fromMemberId: string, toMemberId: string): Promise<void>;
}
