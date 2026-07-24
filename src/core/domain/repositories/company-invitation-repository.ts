import type { CompanyInvitationStatusValue } from "@/domain/services/company-invitation-rules";
import type { CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";

/**
 * Module 18 — Company Professional: repository interface for
 * CompanyInvitation. `tokenHash` is a SHA-256 digest, never the raw token
 * (see company-invitation-rules.ts) — this repository never reads or writes
 * a plaintext token.
 */

export interface CompanyInvitationRecord {
  id: string;
  companyId: string;
  email: string;
  invitedUserId: string | null;
  invitedByUserId: string;
  role: CompanyMemberRoleValue;
  status: CompanyInvitationStatusValue;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyInvitationData {
  companyId: string;
  email: string;
  invitedUserId: string | null;
  invitedByUserId: string;
  role: CompanyMemberRoleValue;
  tokenHash: string;
  expiresAt: Date;
}

export interface CompanyInvitationRepository {
  findById(id: string): Promise<CompanyInvitationRecord | null>;
  /** Looked up by the hash of a raw token presented by an invitee — never by
   *  the raw token itself (the raw token never reaches storage). */
  findByTokenHash(tokenHash: string): Promise<CompanyInvitationRecord | null>;
  /** The one PENDING invitation for this (companyId, email) pair, if any —
   *  backs the "no duplicate pending invitations" rule (also enforced by a
   *  DB partial unique index as the final concurrency guarantee). */
  findPendingByCompanyAndEmail(companyId: string, email: string): Promise<CompanyInvitationRecord | null>;
  listByCompany(companyId: string): Promise<CompanyInvitationRecord[]>;
  /** Invitations addressed to a specific existing user, across every
   *  company — backs "invitations I've received". */
  listForInvitedUser(userId: string): Promise<CompanyInvitationRecord[]>;

  create(data: CreateCompanyInvitationData): Promise<CompanyInvitationRecord>;
  updateStatus(
    id: string,
    data: {
      status: CompanyInvitationStatusValue;
      acceptedAt?: Date | null;
      declinedAt?: Date | null;
      cancelledAt?: Date | null;
    },
  ): Promise<CompanyInvitationRecord>;
}
