import { describe, expect, it } from "vitest";

import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { AccountErasureExecuted } from "@/domain/events/account-erasure-executed";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import {
  ExecuteAccountErasureUseCase,
  type GdprErasureRepos,
} from "@/application/use-cases/gdpr/execute-account-erasure.use-case";
import { RecordAccountErasureExecutedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-account-erasure-executed-audit-log.subscriber";
import type { VerificationDocumentStorageDeleter } from "@/application/interfaces/verification-document-storage-deleter";
import type {
  FraudTrustSignalCheckRepository,
  CreateFraudTrustSignalCheckData,
  FraudTrustSignalCheckRecord,
  FraudTrustSignalCheckType,
} from "@/domain/repositories/fraud-trust-signal-check-repository";
import { FakeAuthTokenRepository } from "../auth/fakes";
import {
  FakeAddressRepository,
  FakeAdminAuditLogRepository,
  FakeCustomerProfileRepository,
  FakeJobRepository,
  FakeNotificationRepository,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
  FakeUserRepository,
} from "./fakes";
import { FakeMarketingAttributionRepository } from "../referral/fakes";
import { FakePartnerRepository } from "../affiliate/fakes";

/**
 * Integration tests for Module 88 — GDPR Erasure Execution & Document
 * Retention. Real `ExecuteAccountErasureUseCase` + its audit-log
 * subscriber, fake repositories swapped in for storage — same convention
 * as gdpr-flows.test.ts (Module 38).
 */

class FakeFraudTrustSignalCheckRepository implements FraudTrustSignalCheckRepository {
  private readonly rowsByUser = new Map<string, number>();

  async create(data: CreateFraudTrustSignalCheckData): Promise<FraudTrustSignalCheckRecord> {
    this.rowsByUser.set(data.userId, (this.rowsByUser.get(data.userId) ?? 0) + 1);
    return { id: "check-1", createdAt: new Date(), ...data };
  }
  async findRecentForUser(_userId: string, _checkType: FraudTrustSignalCheckType): Promise<FraudTrustSignalCheckRecord | null> {
    return null;
  }
  async listUserIdsForDeviceIdHash(): Promise<string[]> {
    return [];
  }
  async deleteForUser(userId: string): Promise<number> {
    const count = this.rowsByUser.get(userId) ?? 0;
    this.rowsByUser.delete(userId);
    return count;
  }
  countForUser(userId: string): number {
    return this.rowsByUser.get(userId) ?? 0;
  }
}

class RecordingDocumentStorageDeleter implements VerificationDocumentStorageDeleter {
  deletedUrls: string[] = [];
  failUrls = new Set<string>();

  async deleteByUrl(fileUrl: string): Promise<void> {
    if (this.failUrls.has(fileUrl)) {
      throw new Error(`simulated storage failure for ${fileUrl}`);
    }
    this.deletedUrls.push(fileUrl);
  }
}

function setup() {
  const users = new FakeUserRepository();
  const addresses = new FakeAddressRepository();
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const notifications = new FakeNotificationRepository();
  const professionalVerifications = new FakeProfessionalVerificationRepository();
  const authTokens = new FakeAuthTokenRepository();
  // Module 93 — Real Fraud & Trust Signal Providers.
  const fraudTrustSignalChecks = new FakeFraudTrustSignalCheckRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  const jobs = new FakeJobRepository();
  const documentStorage = new RecordingDocumentStorageDeleter();
  const eventBus = new SynchronousEventBus();

  eventBus.subscribe(AccountErasureExecuted, new RecordAccountErasureExecutedAuditLogSubscriber(auditLog));

  const marketingAttributions = new FakeMarketingAttributionRepository();
  const partners = new FakePartnerRepository();

  const repos: GdprErasureRepos = {
    users,
    addresses,
    customerProfiles,
    professionals,
    notifications,
    professionalVerifications,
    authTokens,
    fraudTrustSignalChecks,
    marketingAttributions,
    partners,
  };

  const useCase = new ExecuteAccountErasureUseCase(repos, documentStorage, eventBus);

  const user = {
    id: "user-1",
    email: "person@example.com",
    name: "Ana",
    passwordHash: "hash",
    emailVerified: new Date(),
    status: "ACTIVE",
  };
  users.users.set(user.id, user);

  return {
    useCase,
    users,
    addresses,
    customerProfiles,
    professionals,
    notifications,
    professionalVerifications,
    authTokens,
    fraudTrustSignalChecks,
    auditLog,
    jobs,
    documentStorage,
    user,
    marketingAttributions,
    partners,
  };
}

describe("Module 88 — ExecuteAccountErasureUseCase", () => {
  it("throws NotFoundError for a user that does not exist", async () => {
    const { useCase } = setup();
    await expect(useCase.execute("nope", { userId: "nope", isAdmin: false })).rejects.toThrow(NotFoundError);
  });

  it("throws UnauthorizedError when a non-admin actor targets another user's account", async () => {
    const { useCase, user } = setup();
    await expect(
      useCase.execute(user.id, { userId: "someone-else", isAdmin: false }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("allows an admin actor to execute erasure for another user's account", async () => {
    const { useCase, user } = setup();
    const result = await useCase.execute(user.id, { userId: "admin-1", isAdmin: true });
    expect(result.alreadyErased).toBe(false);
  });

  it("anonymizes the user's own account (never hard-deletes it) and blocks credential login", async () => {
    const { useCase, users, user } = setup();

    await useCase.execute(user.id, { userId: user.id, isAdmin: false });

    const updated = await users.findById(user.id);
    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("Deleted user");
    expect(updated?.email).not.toBe("person@example.com");
    expect(updated?.passwordHash).toBeNull();
    expect(updated?.status).toBe("DEACTIVATED");
  });

  it("hard-deletes FraudTrustSignalCheck rows for the erased user (Module 93)", async () => {
    const { useCase, fraudTrustSignalChecks, user } = setup();
    await fraudTrustSignalChecks.create({
      userId: user.id,
      checkType: "DEVICE_FINGERPRINT",
      provider: "FINGERPRINTJS",
      success: true,
      deviceIdHash: "hash-1",
    });
    expect(fraudTrustSignalChecks.countForUser(user.id)).toBe(1);

    await useCase.execute(user.id, { userId: user.id, isAdmin: false });

    expect(fraudTrustSignalChecks.countForUser(user.id)).toBe(0);
  });

  it("erases address and customer-profile PII and revokes auth tokens/sessions", async () => {
    const { useCase, addresses, customerProfiles, authTokens, users, user } = setup();
    await authTokens.createRefreshToken({ userId: user.id, tokenHash: "session-a", expiresAt: new Date(Date.now() + 100000) });

    await useCase.execute(user.id, { userId: user.id, isAdmin: false });

    expect(addresses.erasedUserIds.has(user.id)).toBe(true);
    expect(customerProfiles.erasedUserIds.has(user.id)).toBe(true);
    expect(await authTokens.findValidRefreshToken("session-a")).toBeNull();
    expect(users.invalidatedSessionsFor).toContain(user.id);
  });

  it("hard-deletes notifications and clears professional PII fields, retaining non-PII fields", async () => {
    const { useCase, notifications, professionals, user } = setup();
    await notifications.create({
      userId: user.id,
      type: "NEW_MESSAGE",
      title: "New message",
      message: "You have a new message",
      resourceType: null,
      resourceId: null,
      actionUrl: null,
      metadata: null,
    });
    const professional = await professionals.create(user.id, {
      businessName: "Ana Plumbing",
      bio: "10 years experience",
      contactEmail: "ana@example.com",
      contactPhone: "+34600000000",
      taxId: "B12345678",
    });

    await useCase.execute(user.id, { userId: user.id, isAdmin: false });

    expect(await notifications.listForUser(user.id, { limit: 10, offset: 0 })).toHaveLength(0);
    const updatedProfessional = await professionals.findById(professional.id);
    expect(updatedProfessional?.businessName).toBeNull();
    expect(updatedProfessional?.bio).toBeNull();
    expect(updatedProfessional?.contactEmail).toBeNull();
    expect(updatedProfessional?.contactPhone).toBeNull();
    expect(updatedProfessional?.taxId).toBeNull();
    // Non-PII operational fields survive untouched.
    expect(updatedProfessional?.status).toBe("ACTIVE");
  });

  it("soft-deletes verification documents and purges them from storage", async () => {
    const { useCase, professionals, professionalVerifications, documentStorage, user } = setup();
    const professional = await professionals.create(user.id, {});
    const verification = await professionalVerifications.create(professional.id);
    const doc = await professionalVerifications.addDocument({
      verificationId: verification.id,
      type: "NATIONAL_ID",
      fileUrl: "https://res.cloudinary.com/demo/image/private/v1/maestroya/verifications/v1/doc1.jpg",
      originalFilename: "id.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 1024,
    });

    const result = await useCase.execute(user.id, { userId: user.id, isAdmin: false });

    expect(result.documentsMarkedDeleted).toBe(1);
    expect(result.documentsStoragePurged).toBe(1);
    expect(result.documentsStoragePurgeFailures).toBe(0);
    expect(documentStorage.deletedUrls).toContain(doc.fileUrl);
    expect(await professionalVerifications.listDocumentsPendingStoragePurge(professional.id)).toHaveLength(0);
  });

  it("retries a failed storage purge on the next execution without re-deleting the DB row", async () => {
    const { useCase, professionals, professionalVerifications, documentStorage, user } = setup();
    const professional = await professionals.create(user.id, {});
    const verification = await professionalVerifications.create(professional.id);
    const doc = await professionalVerifications.addDocument({
      verificationId: verification.id,
      type: "PASSPORT",
      fileUrl: "https://res.cloudinary.com/demo/image/private/v1/maestroya/verifications/v1/doc2.jpg",
      originalFilename: "passport.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 2048,
    });
    documentStorage.failUrls.add(doc.fileUrl);

    const first = await useCase.execute(user.id, { userId: user.id, isAdmin: false });
    expect(first.documentsMarkedDeleted).toBe(1);
    expect(first.documentsStoragePurgeFailures).toBe(1);
    expect(first.documentsStoragePurged).toBe(0);

    // The DB row is soft-deleted but storage purge is still outstanding —
    // database state must never claim the file is gone when it isn't.
    let pending = await professionalVerifications.listDocumentsPendingStoragePurge(professional.id);
    expect(pending).toHaveLength(1);

    documentStorage.failUrls.delete(doc.fileUrl);
    const second = await useCase.execute(user.id, { userId: user.id, isAdmin: false });

    // Second run is an idempotent replay of the anonymization (already
    // erased), but the outstanding document purge still gets retried.
    expect(second.alreadyErased).toBe(true);
    expect(second.documentsMarkedDeleted).toBe(0); // not re-soft-deleted
    expect(second.documentsStoragePurged).toBe(1);
    expect(documentStorage.deletedUrls).toContain(doc.fileUrl);

    pending = await professionalVerifications.listDocumentsPendingStoragePurge(professional.id);
    expect(pending).toHaveLength(0);
  });

  it("is idempotent: a second execution does not fail and reports alreadyErased", async () => {
    const { useCase, user } = setup();

    const first = await useCase.execute(user.id, { userId: user.id, isAdmin: false });
    expect(first.alreadyErased).toBe(false);

    const second = await useCase.execute(user.id, { userId: user.id, isAdmin: false });
    expect(second.alreadyErased).toBe(true);
    expect(second.categoriesProcessed).toEqual({});
  });

  it("converges safely under concurrent execution: only one call anonymizes", async () => {
    const { useCase, user } = setup();

    const [a, b] = await Promise.all([
      useCase.execute(user.id, { userId: user.id, isAdmin: false }),
      useCase.execute(user.id, { userId: user.id, isAdmin: false }),
    ]);

    const alreadyErasedFlags = [a.alreadyErased, b.alreadyErased].sort();
    expect(alreadyErasedFlags).toEqual([false, true]);
  });

  it("never mutates financial records (Job) it has no repository access to", async () => {
    const { useCase, jobs, user, professionals } = setup();
    const professional = await professionals.create(user.id, {});
    const job = jobs.seed({ customerId: "cust-1", professionalProfileId: professional.id });
    const before = JSON.stringify(job);

    await useCase.execute(user.id, { userId: user.id, isAdmin: false });

    const after = await jobs.findById(job.id);
    expect(JSON.stringify(after)).toBe(before);
  });

  it("writes a minimal, PII-free audit log entry and publishes the domain event", async () => {
    const { useCase, auditLog, user } = setup();

    await useCase.execute(user.id, { userId: user.id, isAdmin: false });

    const entries = await auditLog.list({ limit: 10, offset: 0 });
    const entry = entries.find((e) => e.action === "GDPR_DELETION_EXECUTED");
    expect(entry).toBeDefined();
    expect(entry?.targetId).toBe(user.id);
    const serialized = JSON.stringify(entry?.metadata ?? {});
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("Ana");
  });

  describe("Module 96 — referral/affiliate erasure", () => {
    it("anonymizes the user's own MarketingAttribution link (userId nulled, visitorId/referral codes preserved)", async () => {
      const { useCase, marketingAttributions, user } = setup();
      await marketingAttributions.upsertTouchState("visitor-1", {
        firstSource: "TELEGRAM",
        firstCampaign: null,
        firstReferralCode: "telegram_valencia",
        firstVisitAt: new Date(),
        lastSource: "TELEGRAM",
        lastCampaign: null,
        lastReferralCode: "telegram_valencia",
        lastVisitAt: new Date(),
      });
      await marketingAttributions.linkUser("visitor-1", user.id);

      await useCase.execute(user.id, { userId: user.id, isAdmin: false });

      const attribution = await marketingAttributions.findByVisitorId("visitor-1");
      expect(attribution?.userId).toBeNull();
      expect(attribution?.visitorId).toBe("visitor-1");
      expect(attribution?.firstReferralCode).toBe("telegram_valencia");
    });

    it("anonymizes the user's own Partner PII (displayName/contactEmail/payoutDetails/notes) while preserving status and financial thresholds", async () => {
      const { useCase, partners, user } = setup();
      const partner = await partners.create({
        userId: user.id,
        type: "TELEGRAM_CHANNEL",
        displayName: "Ana's Channel",
        contactEmail: "ana@example.com",
        payoutMethod: "STRIPE",
        payoutDetails: { stripeConnectAccountId: "acct_ana" },
        minimumPayoutThreshold: 50,
      });
      await partners.updateStatus(partner.id, { status: "APPROVED", approvedAt: new Date(), approvedByUserId: "admin-1" });

      await useCase.execute(user.id, { userId: user.id, isAdmin: false });

      const erased = await partners.findById(partner.id);
      expect(erased?.displayName).not.toContain("Ana");
      expect(erased?.contactEmail).not.toBe("ana@example.com");
      expect(erased?.payoutDetails).toBeNull();
      // Never touched — status/threshold are neither PII nor financial
      // history, and stay intact so admin reporting is unaffected.
      expect(erased?.status).toBe("APPROVED");
      expect(erased?.minimumPayoutThreshold).toBe(50);
    });

    it("is a no-op for a user with no referral/affiliate data at all", async () => {
      const { useCase, user } = setup();
      await expect(useCase.execute(user.id, { userId: user.id, isAdmin: false })).resolves.toBeDefined();
    });
  });
});
