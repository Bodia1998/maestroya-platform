import { describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { AccountDeletionRequested } from "@/domain/events/account-deletion-requested";
import { ConsentGranted } from "@/domain/events/consent-granted";
import { ConsentWithdrawn } from "@/domain/events/consent-withdrawn";
import { PersonalDataExportPrepared } from "@/domain/events/personal-data-export-prepared";
import { PersonalDataExportRequested } from "@/domain/events/personal-data-export-requested";
import { GDPR_DATA_CATEGORIES } from "@/domain/services/gdpr-privacy-rules";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { ExportPersonalDataUseCase } from "@/application/use-cases/gdpr/export-personal-data.use-case";
import { PrepareAccountDeletionUseCase } from "@/application/use-cases/gdpr/prepare-account-deletion.use-case";
import { GrantConsentUseCase } from "@/application/use-cases/gdpr/grant-consent.use-case";
import { WithdrawConsentUseCase } from "@/application/use-cases/gdpr/withdraw-consent.use-case";
import { RecordPersonalDataExportRequestedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-personal-data-export-requested-audit-log.subscriber";
import { RecordPersonalDataExportPreparedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-personal-data-export-prepared-audit-log.subscriber";
import { RecordAccountDeletionRequestedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-account-deletion-requested-audit-log.subscriber";
import { RecordConsentGrantedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-consent-granted-audit-log.subscriber";
import { RecordConsentWithdrawnAuditLogSubscriber } from "@/application/use-cases/gdpr/record-consent-withdrawn-audit-log.subscriber";
import type { GdprInventoryRepos } from "@/application/use-cases/gdpr/gdpr-data-inventory";
import {
  FakeAddressRepository,
  FakeAdminAuditLogRepository,
  FakeAppointmentRepository,
  FakeCompanyInvitationRepository,
  FakeCompanyMembershipRepository,
  FakeConsentRepository,
  FakeConversationRepository,
  FakeCustomerProfileRepository,
  FakeDisputeRepository,
  FakeJobRepository,
  FakeMessageRepository,
  FakeNotificationRepository,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
  FakeQuoteRepository,
  FakeReviewRepository,
  FakeServiceRequestRepository,
  FakeSupportTicketRepository,
  FakeUserRepository,
} from "./fakes";
import { FakeMarketingAttributionRepository } from "../referral/fakes";
import { FakePartnerRepository, FakeAffiliateCommissionRepository } from "../affiliate/fakes";
import { FakeReferralCodeRepository } from "../referral/fakes";

/**
 * Integration tests for Module 38 — GDPR Compliance. Real use cases + the
 * shared `gdpr-data-inventory.ts` gathering logic, fake repositories
 * swapped in for storage — same convention as tests/integration/dispute/
 * dispute-flows.test.ts.
 */

function setup() {
  const users = new FakeUserRepository();
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const addresses = new FakeAddressRepository();
  const companyMembers = new FakeCompanyMembershipRepository();
  const companyInvitations = new FakeCompanyInvitationRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const jobs = new FakeJobRepository();
  const appointments = new FakeAppointmentRepository();
  const conversations = new FakeConversationRepository();
  const messages = new FakeMessageRepository();
  const notifications = new FakeNotificationRepository();
  const reviews = new FakeReviewRepository();
  const supportTickets = new FakeSupportTicketRepository();
  const disputes = new FakeDisputeRepository();
  const professionalVerifications = new FakeProfessionalVerificationRepository();
  const consents = new FakeConsentRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  const marketingAttributions = new FakeMarketingAttributionRepository();
  const partners = new FakePartnerRepository();
  const referralCodes = new FakeReferralCodeRepository();
  const affiliateCommissions = new FakeAffiliateCommissionRepository();
  const eventBus = new SynchronousEventBus();

  const repos: GdprInventoryRepos = {
    users,
    customerProfiles,
    professionals,
    addresses,
    companyMembers,
    companyInvitations,
    serviceRequests,
    quotes,
    jobs,
    appointments,
    conversations,
    messages,
    notifications,
    reviews,
    supportTickets,
    disputes,
    professionalVerifications,
    consents,
    marketingAttributions,
    partners,
    referralCodes,
    affiliateCommissions,
    auditLog,
  };

  eventBus.subscribe(PersonalDataExportRequested, new RecordPersonalDataExportRequestedAuditLogSubscriber(auditLog));
  eventBus.subscribe(PersonalDataExportPrepared, new RecordPersonalDataExportPreparedAuditLogSubscriber(auditLog));
  eventBus.subscribe(AccountDeletionRequested, new RecordAccountDeletionRequestedAuditLogSubscriber(auditLog));
  eventBus.subscribe(ConsentGranted, new RecordConsentGrantedAuditLogSubscriber(auditLog));
  eventBus.subscribe(ConsentWithdrawn, new RecordConsentWithdrawnAuditLogSubscriber(auditLog));

  const user = { id: "user-1", email: "person@example.com", name: "Ana", passwordHash: "hash", emailVerified: null, status: "ACTIVE" };
  users.users.set(user.id, user);
  users.profiles.set(user.id, {
    id: user.id,
    name: "Ana",
    email: user.email,
    phone: null,
    image: null,
    timezone: null,
    notificationPreferences: null,
    preferredLanguageId: null,
    status: "ACTIVE",
    hasPassword: true,
  });

  return {
    repos,
    eventBus,
    auditLog,
    consents,
    user,
    users,
    customerProfiles,
    serviceRequests,
    jobs,
    reviews,
    supportTickets,
    disputes,
    professionals,
  };
}

describe("Module 38 — GDPR Compliance: ExportPersonalDataUseCase", () => {
  it("throws NotFoundError for a user that does not exist", async () => {
    const { repos, eventBus } = setup();
    const useCase = new ExportPersonalDataUseCase(repos, eventBus);
    await expect(useCase.execute("nope")).rejects.toThrow(NotFoundError);
  });

  it("gathers a user's marketplace data and publishes both export events", async () => {
    const { repos, eventBus, auditLog, user, customerProfiles, serviceRequests, jobs, reviews } = setup();

    const customerProfile = await customerProfiles.findOrCreateByUserId(user.id);
    const serviceRequest = await serviceRequests.create(customerProfile.id, user.id, {
      categoryId: "cat-1",
      title: "Fix the sink",
      description: "Leaking under the sink",
      urgency: "MEDIUM",
      budgetMin: 50,
      budgetMax: 100,
      location: {
        line1: "Calle Mayor 1",
        line2: null,
        city: "Gandia",
        province: "Valencia",
        postalCode: "46700",
        country: "ES",
        latitude: null,
        longitude: null,
      },
    });
    const job = jobs.seed({ customerId: customerProfile.id, serviceRequestId: serviceRequest.id });
    await reviews.create({
      jobId: job.id,
      serviceRequestId: serviceRequest.id,
      reviewerId: user.id,
      revieweeProfessionalProfileId: null,
      revieweeCompanyProfileId: null,
      rating: 5,
      comment: "Great work",
    });

    const useCase = new ExportPersonalDataUseCase(repos, eventBus);
    const result = await useCase.execute(user.id);

    expect(result.userId).toBe(user.id);
    expect(result.account?.email).toBe(user.email);
    expect(result.serviceRequests).toHaveLength(1);
    expect(result.serviceRequests[0]!.id).toBe(serviceRequest.id);
    expect(result.jobsAsCustomer).toHaveLength(1);
    expect(result.reviewsAuthored).toHaveLength(1);
    expect(result.reviewsAuthored[0]!.comment).toBe("Great work");

    // Both lifecycle events landed on the audit trail via the registered
    // subscribers.
    const actions = auditLog.entries.map((e) => e.action);
    expect(actions).toContain("GDPR_EXPORT_REQUESTED");
    expect(actions).toContain("GDPR_EXPORT_PREPARED");

    const preparedEntry = auditLog.entries.find((e) => e.action === "GDPR_EXPORT_PREPARED")!;
    expect((preparedEntry.metadata as { categoryCounts: Record<string, number> }).categoryCounts.serviceRequests).toBe(
      1,
    );
  });

  it("returns empty collections (never throws) for a user with no marketplace activity", async () => {
    const { repos, eventBus, user } = setup();
    const useCase = new ExportPersonalDataUseCase(repos, eventBus);

    const result = await useCase.execute(user.id);

    expect(result.serviceRequests).toEqual([]);
    expect(result.jobsAsCustomer).toEqual([]);
    expect(result.customerProfile).toBeNull();
    expect(result.professionalProfile).toBeNull();
  });

  // Module 95 — API Security Hardening (IDOR regression). Before this
  // module, `execute()` took an unchecked `actorUserId` string and never
  // verified it against `userId` — any caller could export any other
  // user's full GDPR inventory by supplying a mismatched actor. These
  // pin the fix: a non-admin actor requesting someone else's export is
  // rejected, an admin actor is allowed, and self-export (the single-arg
  // call every existing caller uses) keeps working unchanged.
  it("rejects exporting another user's data when the actor is not that user and not an admin", async () => {
    const { repos, eventBus, user, users } = setup();
    const attackerId = "user-attacker";
    users.users.set(attackerId, { ...user, id: attackerId, email: "attacker@example.com" });
    const useCase = new ExportPersonalDataUseCase(repos, eventBus);

    await expect(
      useCase.execute(user.id, { userId: attackerId, isAdmin: false }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("allows an admin actor to export another user's data", async () => {
    const { repos, eventBus, user, users } = setup();
    const adminId = "user-admin";
    users.users.set(adminId, { ...user, id: adminId, email: "admin@example.com" });
    const useCase = new ExportPersonalDataUseCase(repos, eventBus);

    const result = await useCase.execute(user.id, { userId: adminId, isAdmin: true });

    expect(result.userId).toBe(user.id);
  });

  it("allows self-export via the default single-argument call", async () => {
    const { repos, eventBus, user } = setup();
    const useCase = new ExportPersonalDataUseCase(repos, eventBus);

    const result = await useCase.execute(user.id);

    expect(result.userId).toBe(user.id);
  });
});

describe("Module 38 — GDPR Compliance: PrepareAccountDeletionUseCase", () => {
  it("throws NotFoundError for a user that does not exist", async () => {
    const { repos, eventBus } = setup();
    const useCase = new PrepareAccountDeletionUseCase(repos, eventBus);
    await expect(useCase.execute("nope")).rejects.toThrow(NotFoundError);
  });

  it("classifies every GDPR data category exactly once, without deleting anything", async () => {
    const { repos, eventBus, auditLog, user, customerProfiles, serviceRequests, jobs } = setup();

    const customerProfile = await customerProfiles.findOrCreateByUserId(user.id);
    const serviceRequest = await serviceRequests.create(customerProfile.id, user.id, {
      categoryId: "cat-1",
      title: "Fix the sink",
      description: "Leaking under the sink",
      urgency: "MEDIUM",
      budgetMin: null,
      budgetMax: null,
      location: {
        line1: "Calle Mayor 1",
        line2: null,
        city: "Gandia",
        province: "Valencia",
        postalCode: "46700",
        country: "ES",
        latitude: null,
        longitude: null,
      },
    });
    jobs.seed({ customerId: customerProfile.id, serviceRequestId: serviceRequest.id });

    const useCase = new PrepareAccountDeletionUseCase(repos, eventBus);
    const plan = await useCase.execute(user.id);

    expect(plan.userId).toBe(user.id);
    expect(plan.eligibleForDeletion).toBe(true);
    expect(plan.categories).toHaveLength(GDPR_DATA_CATEGORIES.length);

    const financial = plan.categories.find((c) => c.category === "MARKETPLACE_FINANCIAL")!;
    expect(financial.strategy).toBe("RETAIN");
    expect(financial.itemCount).toBe(1);
    expect(financial.reason).toBeTruthy();

    const auth = plan.categories.find((c) => c.category === "AUTH_CREDENTIALS")!;
    expect(auth.strategy).toBe("HARD_DELETE");

    // No repository received a mutating call — every fake's underlying map
    // still contains exactly what was seeded (nothing removed/anonymized).
    expect(customerProfiles.profiles.size).toBe(1);
    expect(serviceRequests.requests.size).toBe(1);
    expect(jobs.jobs.size).toBe(1);

    expect(auditLog.entries.some((e) => e.action === "GDPR_DELETION_REQUESTED")).toBe(true);
  });
});

describe("Module 38 — GDPR Compliance: GrantConsentUseCase / WithdrawConsentUseCase", () => {
  it("grants a new consent and publishes ConsentGranted", async () => {
    const { repos, eventBus, auditLog, consents, user } = setup();
    const grant = new GrantConsentUseCase(consents, eventBus);

    const record = await grant.execute(user.id, { type: "TERMS_OF_SERVICE", version: "2026-01-01" });

    expect(record.userId).toBe(user.id);
    expect(record.type).toBe("TERMS_OF_SERVICE");
    expect(record.withdrawnAt).toBeNull();
    expect(auditLog.entries.some((e) => e.action === "GDPR_CONSENT_GRANTED")).toBe(true);
    void repos;
  });

  it("rejects granting the same active consent type twice", async () => {
    const { eventBus, consents, user } = setup();
    const grant = new GrantConsentUseCase(consents, eventBus);

    await grant.execute(user.id, { type: "MARKETING", version: "v1" });
    await expect(grant.execute(user.id, { type: "MARKETING", version: "v2" })).rejects.toThrow(ConflictError);
  });

  it("withdraws an active consent and publishes ConsentWithdrawn", async () => {
    const { eventBus, auditLog, consents, user } = setup();
    const grant = new GrantConsentUseCase(consents, eventBus);
    const withdraw = new WithdrawConsentUseCase(consents, eventBus);

    const granted = await grant.execute(user.id, { type: "MARKETING", version: "v1" });
    const withdrawn = await withdraw.execute(user.id, "MARKETING");

    expect(withdrawn.id).toBe(granted.id);
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(auditLog.entries.some((e) => e.action === "GDPR_CONSENT_WITHDRAWN")).toBe(true);

    // Granting again after withdrawal creates a brand-new row.
    const reGranted = await grant.execute(user.id, { type: "MARKETING", version: "v2" });
    expect(reGranted.id).not.toBe(granted.id);
  });

  it("throws NotFoundError when withdrawing a consent type that was never granted", async () => {
    const { eventBus, consents, user } = setup();
    const withdraw = new WithdrawConsentUseCase(consents, eventBus);

    await expect(withdraw.execute(user.id, "PRIVACY_POLICY")).rejects.toThrow(NotFoundError);
  });
});
