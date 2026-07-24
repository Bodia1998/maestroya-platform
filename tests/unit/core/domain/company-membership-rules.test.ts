import { describe, expect, it } from "vitest";

import {
  canChangeMemberRole,
  canInitiateOwnershipTransfer,
  canInviteMembers,
  canManageCompanyProfile,
  canRemoveMember,
  deriveMembershipStatus,
  isEligibleOwnershipTransferTarget,
  roleRank,
} from "@/domain/services/company-membership-rules";

describe("company-membership-rules (Module 18)", () => {
  describe("deriveMembershipStatus", () => {
    it("derives PENDING/ACTIVE/REMOVED from timestamps", () => {
      expect(deriveMembershipStatus({ joinedAt: null, removedAt: null })).toBe("PENDING");
      expect(deriveMembershipStatus({ joinedAt: new Date(), removedAt: null })).toBe("ACTIVE");
      expect(deriveMembershipStatus({ joinedAt: new Date(), removedAt: new Date() })).toBe("REMOVED");
    });
  });

  describe("roleRank", () => {
    it("ranks OWNER highest and MEMBER lowest", () => {
      expect(roleRank("OWNER")).toBeGreaterThan(roleRank("ADMIN"));
      expect(roleRank("ADMIN")).toBeGreaterThan(roleRank("MANAGER"));
      expect(roleRank("MANAGER")).toBeGreaterThan(roleRank("MEMBER"));
    });
  });

  describe("canManageCompanyProfile / canInviteMembers", () => {
    it("only OWNER/ADMIN may manage the profile or invite members", () => {
      expect(canManageCompanyProfile("OWNER")).toBe(true);
      expect(canManageCompanyProfile("ADMIN")).toBe(true);
      expect(canManageCompanyProfile("MANAGER")).toBe(false);
      expect(canManageCompanyProfile("MEMBER")).toBe(false);

      expect(canInviteMembers("ADMIN")).toBe(true);
      expect(canInviteMembers("MANAGER")).toBe(false);
      expect(canInviteMembers("MEMBER")).toBe(false);
    });
  });

  describe("canChangeMemberRole", () => {
    it("OWNER can change anyone's role except granting/removing OWNER", () => {
      expect(canChangeMemberRole("OWNER", "MEMBER", "MANAGER")).toBe(true);
      expect(canChangeMemberRole("OWNER", "ADMIN", "MEMBER")).toBe(true);
      expect(canChangeMemberRole("OWNER", "MEMBER", "OWNER")).toBe(false);
    });

    it("ADMIN can only manage MANAGER/MEMBER, never promote to ADMIN or touch another ADMIN/OWNER", () => {
      expect(canChangeMemberRole("ADMIN", "MEMBER", "MANAGER")).toBe(true);
      expect(canChangeMemberRole("ADMIN", "MANAGER", "MEMBER")).toBe(true);
      expect(canChangeMemberRole("ADMIN", "MEMBER", "ADMIN")).toBe(false);
      expect(canChangeMemberRole("ADMIN", "ADMIN", "MEMBER")).toBe(false);
      expect(canChangeMemberRole("ADMIN", "OWNER", "MEMBER")).toBe(false);
    });

    it("MANAGER cannot change any role (cannot change critical roles)", () => {
      expect(canChangeMemberRole("MANAGER", "MEMBER", "MANAGER")).toBe(false);
      expect(canChangeMemberRole("MANAGER", "MEMBER", "MEMBER")).toBe(false);
    });

    it("MEMBER cannot manage the company at all", () => {
      expect(canChangeMemberRole("MEMBER", "MEMBER", "MANAGER")).toBe(false);
      expect(canManageCompanyProfile("MEMBER")).toBe(false);
      expect(canInviteMembers("MEMBER")).toBe(false);
    });
  });

  describe("canRemoveMember", () => {
    it("the OWNER can never be removed, by anyone", () => {
      expect(canRemoveMember("OWNER", "OWNER")).toBe(false);
      expect(canRemoveMember("ADMIN", "OWNER")).toBe(false);
    });

    it("OWNER can remove anyone else; ADMIN only MANAGER/MEMBER", () => {
      expect(canRemoveMember("OWNER", "ADMIN")).toBe(true);
      expect(canRemoveMember("OWNER", "MEMBER")).toBe(true);
      expect(canRemoveMember("ADMIN", "MANAGER")).toBe(true);
      expect(canRemoveMember("ADMIN", "MEMBER")).toBe(true);
      expect(canRemoveMember("ADMIN", "ADMIN")).toBe(false);
    });

    it("MANAGER/MEMBER cannot remove anyone", () => {
      expect(canRemoveMember("MANAGER", "MEMBER")).toBe(false);
      expect(canRemoveMember("MEMBER", "MEMBER")).toBe(false);
    });
  });

  describe("ownership transfer eligibility", () => {
    it("only the OWNER can initiate a transfer", () => {
      expect(canInitiateOwnershipTransfer("OWNER")).toBe(true);
      expect(canInitiateOwnershipTransfer("ADMIN")).toBe(false);
      expect(canInitiateOwnershipTransfer("MANAGER")).toBe(false);
      expect(canInitiateOwnershipTransfer("MEMBER")).toBe(false);
    });

    it("the target must be an active member and not the current owner themself", () => {
      expect(isEligibleOwnershipTransferTarget("ACTIVE", false)).toBe(true);
      expect(isEligibleOwnershipTransferTarget("PENDING", false)).toBe(false);
      expect(isEligibleOwnershipTransferTarget("REMOVED", false)).toBe(false);
      expect(isEligibleOwnershipTransferTarget("ACTIVE", true)).toBe(false);
    });
  });
});
