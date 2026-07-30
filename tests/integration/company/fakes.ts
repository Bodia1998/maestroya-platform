import type { AuthUserRecord, UserRepository } from "@/domain/repositories/user-repository";
import type {
  CompanyRecord,
  CompanyRepository,
  CreateCompanyData,
  UpdateCompanyData,
} from "@/domain/repositories/company-repository";
import type { CompanyStatusValue } from "@/domain/services/company-rules";
import type {
  CompanyMemberRecord,
  CompanyMemberWithUser,
  CompanyMembershipRepository,
} from "@/domain/repositories/company-membership-repository";
import type { CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";
import type {
  CompanyInvitationRecord,
  CompanyInvitationRepository,
  CreateCompanyInvitationData,
} from "@/domain/repositories/company-invitation-repository";
import type { CompanyInvitationStatusValue } from "@/domain/services/company-invitation-rules";
import type { ServiceCategoryRecord, ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";

/**
 * Module 18 — Company Professional: in-memory test doubles, same pattern
 * as tests/integration/portfolio/fakes.ts / tests/integration/admin/fakes.ts
 * — implement the real interfaces so use cases under test run their genuine
 * orchestration/authorization logic.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeCompanyRepository implements CompanyRepository {
  companies = new Map<string, CompanyRecord>();

  async findById(id: string) {
    return this.companies.get(id) ?? null;
  }
  async findByOwnerUserId(ownerUserId: string) {
    return [...this.companies.values()].find((c) => c.ownerUserId === ownerUserId) ?? null;
  }
  async findBySlug(slug: string) {
    return [...this.companies.values()].find((c) => c.slug === slug) ?? null;
  }
  async findByTaxId(taxId: string) {
    return [...this.companies.values()].find((c) => c.taxId === taxId) ?? null;
  }
  async existsBySlug(slug: string) {
    return [...this.companies.values()].some((c) => c.slug === slug);
  }

  async create(ownerUserId: string, data: CreateCompanyData): Promise<CompanyRecord> {
    const now = new Date();
    const record: CompanyRecord = {
      id: nextId("fake-company"),
      ownerUserId,
      legalName: data.legalName,
      tradeName: data.tradeName ?? null,
      taxId: data.taxId,
      description: data.description ?? null,
      logoUrl: data.logoUrl ?? null,
      websiteUrl: data.websiteUrl ?? null,
      slug: data.slug,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      addressLine: data.addressLine ?? null,
      city: data.city ?? null,
      province: data.province ?? null,
      postalCode: data.postalCode ?? null,
      country: data.country ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      status: "PENDING",
      suspendedAt: null,
      isVerified: false,
      verifiedAt: null,
      stripeConnectAccountId: null,
      averageRating: null,
      reviewCount: 0,
      isAcceptingRequests: true,
      categoryIds: data.categoryIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.companies.set(record.id, record);
    return record;
  }

  async update(id: string, data: UpdateCompanyData): Promise<CompanyRecord> {
    const existing = this.companies.get(id);
    if (!existing) throw new Error(`No fake company ${id}`);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.companies.set(id, updated);
    return updated;
  }

  async updateStatus(id: string, status: CompanyStatusValue, suspendedAt: Date | null): Promise<void> {
    const existing = this.companies.get(id);
    if (existing) this.companies.set(id, { ...existing, status, suspendedAt, updatedAt: new Date() });
  }

  async updateCategories(id: string, categoryIds: string[]): Promise<CompanyRecord> {
    const existing = this.companies.get(id);
    if (!existing) throw new Error(`No fake company ${id}`);
    const updated = { ...existing, categoryIds: [...categoryIds], updatedAt: new Date() };
    this.companies.set(id, updated);
    return updated;
  }

  async updateOwner(id: string, newOwnerUserId: string): Promise<void> {
    const existing = this.companies.get(id);
    if (existing) this.companies.set(id, { ...existing, ownerUserId: newOwnerUserId, updatedAt: new Date() });
  }
}

export class FakeCompanyMembershipRepository implements CompanyMembershipRepository {
  members = new Map<string, CompanyMemberRecord & { userName: string | null; userEmail: string | null }>();

  seed(overrides: Partial<CompanyMemberRecord> & { companyId: string; userId: string }) {
    const now = new Date();
    const record = {
      id: nextId("fake-member"),
      role: "MEMBER" as CompanyMemberRoleValue,
      invitedAt: now,
      joinedAt: now,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
      userName: "Member",
      userEmail: "member@example.com",
      ...overrides,
    };
    this.members.set(record.id, record);
    return record;
  }

  async findById(id: string) {
    return this.members.get(id) ?? null;
  }
  async findByCompanyAndUser(companyId: string, userId: string) {
    return [...this.members.values()].find((m) => m.companyId === companyId && m.userId === userId) ?? null;
  }
  async listActiveCompaniesForUser(userId: string) {
    return [...this.members.values()].filter((m) => m.userId === userId && m.joinedAt && !m.removedAt);
  }
  async listByCompany(companyId: string): Promise<CompanyMemberWithUser[]> {
    return [...this.members.values()].filter((m) => m.companyId === companyId);
  }
  async findOwner(companyId: string) {
    return (
      [...this.members.values()].find((m) => m.companyId === companyId && m.role === "OWNER" && !m.removedAt) ?? null
    );
  }
  async countActiveMembers(companyId: string) {
    return [...this.members.values()].filter((m) => m.companyId === companyId && m.joinedAt && !m.removedAt).length;
  }

  async createOwner(companyId: string, userId: string) {
    return this.seed({ companyId, userId, role: "OWNER" });
  }
  async createFromAcceptedInvitation(companyId: string, userId: string, role: CompanyMemberRoleValue) {
    return this.seed({ companyId, userId, role });
  }
  async updateRole(id: string, role: CompanyMemberRoleValue) {
    const existing = this.members.get(id);
    if (!existing) throw new Error(`No fake member ${id}`);
    const updated = { ...existing, role, updatedAt: new Date() };
    this.members.set(id, updated);
    return updated;
  }
  async remove(id: string, removedAt: Date) {
    const existing = this.members.get(id);
    if (existing) this.members.set(id, { ...existing, removedAt, updatedAt: new Date() });
  }
  async transferOwnership(companyId: string, fromMemberId: string, toMemberId: string) {
    void companyId;
    const from = this.members.get(fromMemberId);
    const to = this.members.get(toMemberId);
    if (from) this.members.set(fromMemberId, { ...from, role: "ADMIN", updatedAt: new Date() });
    if (to) this.members.set(toMemberId, { ...to, role: "OWNER", updatedAt: new Date() });
  }
}

export class FakeCompanyInvitationRepository implements CompanyInvitationRepository {
  invitations = new Map<string, CompanyInvitationRecord>();

  async findById(id: string) {
    return this.invitations.get(id) ?? null;
  }
  async findByTokenHash(tokenHash: string) {
    return [...this.invitations.values()].find((i) => i.tokenHash === tokenHash) ?? null;
  }
  async findPendingByCompanyAndEmail(companyId: string, email: string) {
    return (
      [...this.invitations.values()].find(
        (i) => i.companyId === companyId && i.email === email && i.status === "PENDING",
      ) ?? null
    );
  }
  async listByCompany(companyId: string) {
    return [...this.invitations.values()].filter((i) => i.companyId === companyId);
  }
  async listForInvitedUser(userId: string) {
    return [...this.invitations.values()].filter((i) => i.invitedUserId === userId);
  }

  async create(data: CreateCompanyInvitationData): Promise<CompanyInvitationRecord> {
    const now = new Date();
    const record: CompanyInvitationRecord = {
      id: nextId("fake-invitation"),
      companyId: data.companyId,
      email: data.email,
      invitedUserId: data.invitedUserId,
      invitedByUserId: data.invitedByUserId,
      role: data.role,
      status: "PENDING",
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      acceptedAt: null,
      declinedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.invitations.set(record.id, record);
    return record;
  }

  async updateStatus(
    id: string,
    data: {
      status: CompanyInvitationStatusValue;
      acceptedAt?: Date | null;
      declinedAt?: Date | null;
      cancelledAt?: Date | null;
    },
  ): Promise<CompanyInvitationRecord> {
    const existing = this.invitations.get(id);
    if (!existing) throw new Error(`No fake invitation ${id}`);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.invitations.set(id, updated);
    return updated;
  }
}

export class FakeUserRepository implements UserRepository {
  users = new Map<string, AuthUserRecord>();

  seed(overrides: Partial<AuthUserRecord> & { id: string }): AuthUserRecord {
    const record: AuthUserRecord = {
      email: null,
      name: null,
      passwordHash: null,
      emailVerified: null,
      status: "ACTIVE",
      ...overrides,
    };
    this.users.set(record.id, record);
    return record;
  }

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createWithPassword(input: { email: string; name: string; passwordHash: string }) {
    return this.seed({ id: nextId("fake-user"), ...input });
  }
  async updatePasswordHash() {}
  async markEmailVerified() {}
  async updateLastLoginAt() {}
  async getRoleKeys() {
    return [];
  }
  async assignDefaultRole() {}
  async findProfileById() {
    return null;
  }
  async updateProfile() {}
  async updateAvatar() {}
  async softDeleteAccount() {}
  async getSignupIntent() {
    return null;
  }
  async clearSignupIntent() {}
}

export class FakeServiceCategoryRepository implements ServiceCategoryRepository {
  categories = new Map<string, ServiceCategoryRecord>();

  seed(category: ServiceCategoryRecord) {
    this.categories.set(category.id, category);
    return category;
  }
  async listActive() {
    return [...this.categories.values()];
  }
  async findActiveByIds(ids: string[]) {
    const unique = new Set(ids);
    return [...this.categories.values()].filter((c) => unique.has(c.id));
  }
}
