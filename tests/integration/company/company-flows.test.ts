import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import { CreateCompanyUseCase } from "@/application/use-cases/company/create-company.use-case";
import { GetCompanyForMemberUseCase } from "@/application/use-cases/company/get-company-for-member.use-case";
import { UpdateCompanyUseCase } from "@/application/use-cases/company/update-company.use-case";
import { ChangeCompanyMemberRoleUseCase } from "@/application/use-cases/company-membership/change-company-member-role.use-case";
import { RemoveCompanyMemberUseCase } from "@/application/use-cases/company-membership/remove-company-member.use-case";
import { TransferCompanyOwnershipUseCase } from "@/application/use-cases/company-membership/transfer-company-ownership.use-case";
import { CreateCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/create-company-invitation.use-case";
import { AcceptCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/accept-company-invitation.use-case";
import { DeclineCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/decline-company-invitation.use-case";
import { generateInvitationToken } from "@/domain/services/company-invitation-rules";

import { FakeAdminAuditLogRepository } from "../admin/fakes";
import {
  FakeCompanyInvitationRepository,
  FakeCompanyMembershipRepository,
  FakeCompanyRepository,
  FakeServiceCategoryRepository,
  FakeUserRepository,
} from "./fakes";

describe("Module 18 — Company Professional integration flows", () => {
  let companies: FakeCompanyRepository;
  let memberships: FakeCompanyMembershipRepository;
  let invitations: FakeCompanyInvitationRepository;
  let users: FakeUserRepository;
  let categories: FakeServiceCategoryRepository;
  let auditLog: FakeAdminAuditLogRepository;
  const notifications = new NullNotificationCreator();

  beforeEach(() => {
    companies = new FakeCompanyRepository();
    memberships = new FakeCompanyMembershipRepository();
    invitations = new FakeCompanyInvitationRepository();
    users = new FakeUserRepository();
    categories = new FakeServiceCategoryRepository();
    auditLog = new FakeAdminAuditLogRepository();
  });

  async function createCompany(ownerUserId: string) {
    const useCase = new CreateCompanyUseCase(companies, memberships, categories);
    return useCase.execute(ownerUserId, {
      legalName: "Juan & Pedro Plumbing S.L.",
      taxId: `TAX-${ownerUserId}`,
    });
  }

  describe("Company creation", () => {
    it("creates the company and seeds an OWNER membership for the creator", async () => {
      const company = await createCompany("owner-1");
      const owner = await memberships.findByCompanyAndUser(company.id, "owner-1");
      expect(owner?.role).toBe("OWNER");
      expect(company.slug).toBeTruthy();
    });

    it("rejects a duplicate tax ID", async () => {
      const useCase = new CreateCompanyUseCase(companies, memberships, categories);
      await useCase.execute("owner-1", { legalName: "A", taxId: "DUPLICATE" });
      await expect(useCase.execute("owner-2", { legalName: "B", taxId: "DUPLICATE" })).rejects.toThrow(ConflictError);
    });
  });

  describe("Company profile management authorization", () => {
    it("OWNER/ADMIN can update the profile; MANAGER/MEMBER cannot", async () => {
      const company = await createCompany("owner-1");
      memberships.seed({ companyId: company.id, userId: "admin-1", role: "ADMIN" });
      memberships.seed({ companyId: company.id, userId: "manager-1", role: "MANAGER" });
      memberships.seed({ companyId: company.id, userId: "member-1", role: "MEMBER" });

      const updateUseCase = new UpdateCompanyUseCase(companies, memberships);

      await expect(updateUseCase.execute("owner-1", company.id, { legalName: "New Name" })).resolves.toMatchObject({
        legalName: "New Name",
      });
      await expect(updateUseCase.execute("admin-1", company.id, { legalName: "Admin Edit" })).resolves.toBeTruthy();
      await expect(updateUseCase.execute("manager-1", company.id, { legalName: "Nope" })).rejects.toThrow(
        UnauthorizedError,
      );
      await expect(updateUseCase.execute("member-1", company.id, { legalName: "Nope" })).rejects.toThrow(
        UnauthorizedError,
      );
    });

    it("cross-company isolation: a member of company A cannot access company B", async () => {
      const companyA = await createCompany("owner-a");
      const companyB = await createCompany("owner-b");
      memberships.seed({ companyId: companyA.id, userId: "member-a", role: "MEMBER" });

      const getUseCase = new GetCompanyForMemberUseCase(companies, memberships);
      await expect(getUseCase.execute("member-a", companyA.id)).resolves.toBeTruthy();
      await expect(getUseCase.execute("member-a", companyB.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe("Membership role changes", () => {
    it("OWNER can promote a MEMBER to MANAGER", async () => {
      const company = await createCompany("owner-1");
      const member = memberships.seed({ companyId: company.id, userId: "member-1", role: "MEMBER" });

      const useCase = new ChangeCompanyMemberRoleUseCase(memberships, auditLog, notifications);
      const updated = await useCase.execute("owner-1", company.id, member.id, "MANAGER");
      expect(updated.role).toBe("MANAGER");
    });

    it("ADMIN cannot promote to ADMIN or touch another ADMIN (cannot perform owner-only actions)", async () => {
      const company = await createCompany("owner-1");
      memberships.seed({ companyId: company.id, userId: "admin-1", role: "ADMIN" });
      const otherAdmin = memberships.seed({ companyId: company.id, userId: "admin-2", role: "ADMIN" });
      const member = memberships.seed({ companyId: company.id, userId: "member-1", role: "MEMBER" });

      const useCase = new ChangeCompanyMemberRoleUseCase(memberships, auditLog, notifications);
      await expect(useCase.execute("admin-1", company.id, member.id, "ADMIN")).rejects.toThrow(UnauthorizedError);
      await expect(useCase.execute("admin-1", company.id, otherAdmin.id, "MEMBER")).rejects.toThrow(
        UnauthorizedError,
      );
    });

    it("MANAGER cannot change any member's role (cannot change critical roles)", async () => {
      const company = await createCompany("owner-1");
      memberships.seed({ companyId: company.id, userId: "manager-1", role: "MANAGER" });
      const member = memberships.seed({ companyId: company.id, userId: "member-1", role: "MEMBER" });

      const useCase = new ChangeCompanyMemberRoleUseCase(memberships, auditLog, notifications);
      await expect(useCase.execute("manager-1", company.id, member.id, "MANAGER")).rejects.toThrow(
        UnauthorizedError,
      );
    });
  });

  describe("Membership removal", () => {
    it("the OWNER can never be removed, even by themself", async () => {
      const company = await createCompany("owner-1");
      const owner = await memberships.findByCompanyAndUser(company.id, "owner-1");

      const useCase = new RemoveCompanyMemberUseCase(memberships, auditLog, notifications);
      await expect(useCase.execute("owner-1", company.id, owner!.id)).rejects.toThrow(UnauthorizedError);
    });

    it("MEMBER cannot manage/remove another member", async () => {
      const company = await createCompany("owner-1");
      memberships.seed({ companyId: company.id, userId: "member-1", role: "MEMBER" });
      const member2 = memberships.seed({ companyId: company.id, userId: "member-2", role: "MEMBER" });

      const useCase = new RemoveCompanyMemberUseCase(memberships, auditLog, notifications);
      await expect(useCase.execute("member-1", company.id, member2.id)).rejects.toThrow(UnauthorizedError);
    });

    it("a MEMBER can remove (leave) themself", async () => {
      const company = await createCompany("owner-1");
      const member = memberships.seed({ companyId: company.id, userId: "member-1", role: "MEMBER" });

      const useCase = new RemoveCompanyMemberUseCase(memberships, auditLog, notifications);
      await useCase.execute("member-1", company.id, member.id);
      const reloaded = await memberships.findById(member.id);
      expect(reloaded?.removedAt).not.toBeNull();
    });
  });

  describe("Ownership transfer", () => {
    it("the OWNER can transfer ownership, and roles update correctly", async () => {
      const company = await createCompany("owner-1");
      const owner = await memberships.findByCompanyAndUser(company.id, "owner-1");
      const admin = memberships.seed({ companyId: company.id, userId: "admin-1", role: "ADMIN" });

      const useCase = new TransferCompanyOwnershipUseCase(companies, memberships, auditLog, notifications);
      await useCase.execute("owner-1", company.id, admin.id);

      const newOwnerRow = await memberships.findById(admin.id);
      const oldOwnerRow = await memberships.findById(owner!.id);
      expect(newOwnerRow?.role).toBe("OWNER");
      expect(oldOwnerRow?.role).toBe("ADMIN");

      const updatedCompany = await companies.findById(company.id);
      expect(updatedCompany?.ownerUserId).toBe("admin-1");
    });

    it("only the current OWNER may initiate a transfer", async () => {
      const company = await createCompany("owner-1");
      memberships.seed({ companyId: company.id, userId: "admin-1", role: "ADMIN" });
      const member = memberships.seed({ companyId: company.id, userId: "member-1", role: "MEMBER" });

      const useCase = new TransferCompanyOwnershipUseCase(companies, memberships, auditLog, notifications);
      await expect(useCase.execute("admin-1", company.id, member.id)).rejects.toThrow(UnauthorizedError);
    });

    it("cannot transfer to a non-active (removed/pending) member", async () => {
      const company = await createCompany("owner-1");
      const removed = memberships.seed({
        companyId: company.id,
        userId: "gone-1",
        role: "MEMBER",
        removedAt: new Date(),
      });

      const useCase = new TransferCompanyOwnershipUseCase(companies, memberships, auditLog, notifications);
      await expect(useCase.execute("owner-1", company.id, removed.id)).rejects.toThrow(ValidationError);
    });
  });

  describe("Invitations", () => {
    async function makeInvitationUseCase() {
      return new CreateCompanyInvitationUseCase(invitations, memberships, users, auditLog, notifications);
    }

    it("rejects duplicate pending invitations for the same email", async () => {
      const company = await createCompany("owner-1");
      users.seed({ id: "invitee-1", email: "invitee@example.com" });
      const useCase = await makeInvitationUseCase();

      await useCase.execute("owner-1", company.id, { email: "invitee@example.com", role: "MEMBER" });
      await expect(
        useCase.execute("owner-1", company.id, { email: "invitee@example.com", role: "MANAGER" }),
      ).rejects.toThrow(ConflictError);
    });

    it("only OWNER/ADMIN may invite members", async () => {
      const company = await createCompany("owner-1");
      memberships.seed({ companyId: company.id, userId: "member-1", role: "MEMBER" });
      const useCase = await makeInvitationUseCase();

      await expect(
        useCase.execute("member-1", company.id, { email: "someone@example.com", role: "MEMBER" }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("an invitation cannot be accepted by a different authenticated user than it was addressed to", async () => {
      const company = await createCompany("owner-1");
      const invitee = users.seed({ id: "invitee-1", email: "invitee@example.com" });
      const attacker = users.seed({ id: "attacker-1", email: "attacker@example.com" });
      void invitee;

      const createUseCase = await makeInvitationUseCase();
      const { token } = await createUseCase.execute("owner-1", company.id, {
        email: "invitee@example.com",
        role: "MEMBER",
      });

      const acceptUseCase = new AcceptCompanyInvitationUseCase(invitations, memberships, users, auditLog, notifications);
      await expect(acceptUseCase.execute(attacker.id, token)).rejects.toThrow(UnauthorizedError);
      // The rightful invitee can still accept it afterwards.
      await expect(acceptUseCase.execute("invitee-1", token)).resolves.toMatchObject({ status: "ACCEPTED" });
    });

    it("expired invitations cannot be accepted", async () => {
      const company = await createCompany("owner-1");
      users.seed({ id: "invitee-1", email: "invitee@example.com" });
      const { tokenHash, token } = generateInvitationToken();
      await invitations.create({
        companyId: company.id,
        email: "invitee@example.com",
        invitedUserId: "invitee-1",
        invitedByUserId: "owner-1",
        role: "MEMBER",
        tokenHash,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      });

      const acceptUseCase = new AcceptCompanyInvitationUseCase(invitations, memberships, users, auditLog, notifications);
      await expect(acceptUseCase.execute("invitee-1", token)).rejects.toThrow(ConflictError);
    });

    it("a cancelled invitation cannot be accepted or declined", async () => {
      const company = await createCompany("owner-1");
      users.seed({ id: "invitee-1", email: "invitee@example.com" });
      const { tokenHash, token } = generateInvitationToken();
      const invitation = await invitations.create({
        companyId: company.id,
        email: "invitee@example.com",
        invitedUserId: "invitee-1",
        invitedByUserId: "owner-1",
        role: "MEMBER",
        tokenHash,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      });
      await invitations.updateStatus(invitation.id, { status: "CANCELLED", cancelledAt: new Date() });

      const acceptUseCase = new AcceptCompanyInvitationUseCase(invitations, memberships, users, auditLog, notifications);
      const declineUseCase = new DeclineCompanyInvitationUseCase(invitations, users, auditLog, notifications);
      await expect(acceptUseCase.execute("invitee-1", token)).rejects.toThrow(ConflictError);
      await expect(declineUseCase.execute("invitee-1", token)).rejects.toThrow(ConflictError);
    });

    it("accepting an invitation creates an active membership with the invited role", async () => {
      const company = await createCompany("owner-1");
      users.seed({ id: "invitee-1", email: "invitee@example.com" });
      const createUseCase = await makeInvitationUseCase();
      const { token } = await createUseCase.execute("owner-1", company.id, {
        email: "invitee@example.com",
        role: "MANAGER",
      });

      const acceptUseCase = new AcceptCompanyInvitationUseCase(invitations, memberships, users, auditLog, notifications);
      await acceptUseCase.execute("invitee-1", token);

      const membership = await memberships.findByCompanyAndUser(company.id, "invitee-1");
      expect(membership?.role).toBe("MANAGER");
      expect(membership?.joinedAt).not.toBeNull();
    });

    it("rejects accepting the same invitation twice", async () => {
      const company = await createCompany("owner-1");
      users.seed({ id: "invitee-1", email: "invitee@example.com" });
      const createUseCase = await makeInvitationUseCase();
      const { token } = await createUseCase.execute("owner-1", company.id, {
        email: "invitee@example.com",
        role: "MEMBER",
      });

      const acceptUseCase = new AcceptCompanyInvitationUseCase(invitations, memberships, users, auditLog, notifications);
      await acceptUseCase.execute("invitee-1", token);
      await expect(acceptUseCase.execute("invitee-1", token)).rejects.toThrow(ConflictError);
    });
  });
});
