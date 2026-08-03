import { describe, expect, it } from "vitest";

import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import { ExpireCompanyVerificationsUseCase } from "@/application/use-cases/workflow-expiration/expire-company-verifications.use-case";
import { ExpireProfessionalVerificationsUseCase } from "@/application/use-cases/workflow-expiration/expire-professional-verifications.use-case";
import { ExpireQuotesUseCase } from "@/application/use-cases/workflow-expiration/expire-quotes.use-case";
import { ExpireServiceRequestsUseCase } from "@/application/use-cases/workflow-expiration/expire-service-requests.use-case";
import { RunWorkflowExpirationsUseCase } from "@/application/use-cases/workflow-expiration/run-workflow-expirations.use-case";
import { FakeCustomerProfileRepository, FakeQuoteRepository, FakeServiceRequestRepository } from "../quotes/fakes";
import { FakeProfessionalRepository } from "../quotes/fakes";
import { FakeCompanyMembershipRepository } from "../company/fakes";
import { FakeAdminAuditLogRepository } from "../dispute/fakes";
import { FakeProfessionalVerificationRepository } from "../verification/fakes";
import { FakeCompanyVerificationRepository } from "./fakes";

/**
 * Module 28 — Workflow Completion: integration coverage for the four
 * expiration batch use cases plus the orchestrator, following the same
 * "real use cases + domain rules, fake repositories for storage" pattern
 * every other module's *-flows.test.ts uses (see e.g.
 * tests/integration/dispute/dispute-flows.test.ts).
 */

class FakeNotificationCreator implements NotificationCreator {
  events: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

const NOW = new Date("2026-08-03T00:00:00Z");
const PAST = new Date("2026-08-01T00:00:00Z");
const FUTURE = new Date("2026-08-20T00:00:00Z");

describe("ExpireServiceRequestsUseCase", () => {
  it("expires PUBLISHED/QUOTED requests past expiresAt, notifies the customer, leaves others untouched", async () => {
    const serviceRequests = new FakeServiceRequestRepository();
    const customerProfiles = new FakeCustomerProfileRepository();
    const auditLog = new FakeAdminAuditLogRepository();
    const notifications = new FakeNotificationCreator();

    const customer = await customerProfiles.findOrCreateByUserId("customer-1");
    const base = {
      customerId: customer.id,
      categoryId: "cat-1",
      categoryName: "Plumbing",
      title: "Fix tap",
      description: "desc",
      urgency: "MEDIUM" as const,
      budgetMin: null,
      budgetMax: null,
      location: {
        line1: "Calle 1",
        line2: null,
        city: "Oliva",
        province: "Valencia",
        postalCode: "46780",
        country: "ES",
        latitude: null,
        longitude: null,
      },
      photos: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const expiredOne = serviceRequests.seed({ ...base, id: "req-expired-published", status: "PUBLISHED", expiresAt: PAST });
    const expiredTwo = serviceRequests.seed({ ...base, id: "req-expired-quoted", status: "QUOTED", expiresAt: PAST });
    const notYet = serviceRequests.seed({ ...base, id: "req-not-yet", status: "PUBLISHED", expiresAt: FUTURE });
    const noExpiry = serviceRequests.seed({ ...base, id: "req-no-expiry", status: "PUBLISHED", expiresAt: null });
    const alreadyAccepted = serviceRequests.seed({ ...base, id: "req-accepted", status: "ACCEPTED", expiresAt: PAST });

    const useCase = new ExpireServiceRequestsUseCase(serviceRequests, customerProfiles, auditLog, notifications);
    const result = await useCase.execute(NOW);

    expect(result.expiredCount).toBe(2);
    expect(new Set(result.ids)).toEqual(new Set([expiredOne.id, expiredTwo.id]));

    expect((await serviceRequests.findById(expiredOne.id))?.status).toBe("EXPIRED");
    expect((await serviceRequests.findById(expiredTwo.id))?.status).toBe("EXPIRED");
    expect((await serviceRequests.findById(notYet.id))?.status).toBe("PUBLISHED");
    expect((await serviceRequests.findById(noExpiry.id))?.status).toBe("PUBLISHED");
    expect((await serviceRequests.findById(alreadyAccepted.id))?.status).toBe("ACCEPTED");

    expect(notifications.events).toHaveLength(2);
    expect(notifications.events.every((e) => e.type === "SERVICE_REQUEST_EXPIRED")).toBe(true);
    expect(notifications.events.every((e) => e.userId === "customer-1")).toBe(true);

    expect(auditLog.entries.filter((e) => e.action === "SERVICE_REQUEST_EXPIRED")).toHaveLength(2);
  });

  it("is a no-op when nothing is expirable", async () => {
    const serviceRequests = new FakeServiceRequestRepository();
    const customerProfiles = new FakeCustomerProfileRepository();
    const auditLog = new FakeAdminAuditLogRepository();
    const useCase = new ExpireServiceRequestsUseCase(serviceRequests, customerProfiles, auditLog);
    const result = await useCase.execute(NOW);
    expect(result).toEqual({ expiredCount: 0, ids: [] });
  });
});

describe("ExpireQuotesUseCase", () => {
  it("expires PENDING/SENT/VIEWED quotes past validUntil and notifies the submitting professional", async () => {
    const quotes = new FakeQuoteRepository();
    const professionals = new FakeProfessionalRepository();
    const auditLog = new FakeAdminAuditLogRepository();
    const notifications = new FakeNotificationCreator();

    const professional = await professionals.create("pro-user-1", {});

    const expired = await quotes.create({
      serviceRequestId: "req-1",
      professionalProfileId: professional.id,
      submittedByUserId: "pro-user-1",
      totalAmount: 100,
      currency: "EUR",
      validUntil: PAST,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
    });
    const notYet = await quotes.create({
      serviceRequestId: "req-2",
      professionalProfileId: professional.id,
      submittedByUserId: "pro-user-1",
      totalAmount: 50,
      currency: "EUR",
      validUntil: FUTURE,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 50 }],
    });

    const useCase = new ExpireQuotesUseCase(quotes, professionals, auditLog, notifications);
    const result = await useCase.execute(NOW);

    expect(result.expiredCount).toBe(1);
    expect(result.ids).toEqual([expired.id]);
    expect((await quotes.findById(expired.id))?.status).toBe("EXPIRED");
    expect((await quotes.findById(notYet.id))?.status).toBe("SENT");

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]?.type).toBe("QUOTE_EXPIRED");
    expect(notifications.events[0]?.userId).toBe("pro-user-1");
  });
});

describe("ExpireProfessionalVerificationsUseCase", () => {
  it("expires APPROVED cases past expiresAt and notifies the professional", async () => {
    const professionals = new FakeProfessionalRepository();
    const verifications = new FakeProfessionalVerificationRepository(professionals);
    const auditLog = new FakeAdminAuditLogRepository();
    const notifications = new FakeNotificationCreator();

    const professional = await professionals.create("pro-user-2", {});
    const created = await verifications.create(professional.id);
    const approved = await verifications.updateStatus(created.id, { status: "APPROVED", expiresAt: PAST });

    const useCase = new ExpireProfessionalVerificationsUseCase(verifications, professionals, auditLog, notifications);
    const result = await useCase.execute(NOW);

    expect(result.expiredCount).toBe(1);
    expect(result.ids).toEqual([approved.id]);
    expect((await verifications.findById(approved.id))?.status).toBe("EXPIRED");
    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]?.type).toBe("VERIFICATION_EXPIRED");
    expect(notifications.events[0]?.userId).toBe("pro-user-2");
  });

  it("does not touch a DRAFT/PENDING case even with a stale-looking expiresAt", async () => {
    const professionals = new FakeProfessionalRepository();
    const verifications = new FakeProfessionalVerificationRepository(professionals);
    const auditLog = new FakeAdminAuditLogRepository();

    const professional = await professionals.create("pro-user-3", {});
    const draft = await verifications.create(professional.id);

    const useCase = new ExpireProfessionalVerificationsUseCase(verifications, professionals, auditLog);
    const result = await useCase.execute(NOW);
    expect(result.expiredCount).toBe(0);
    expect((await verifications.findById(draft.id))?.status).toBe("DRAFT");
  });
});

describe("ExpireCompanyVerificationsUseCase", () => {
  it("expires APPROVED cases past expiresAt and notifies every active company member", async () => {
    const verifications = new FakeCompanyVerificationRepository();
    const companyMembers = new FakeCompanyMembershipRepository();
    const auditLog = new FakeAdminAuditLogRepository();
    const notifications = new FakeNotificationCreator();

    companyMembers.seed({ companyId: "company-1", userId: "owner-1", role: "OWNER" });
    companyMembers.seed({ companyId: "company-1", userId: "admin-1", role: "ADMIN" });
    companyMembers.seed({ companyId: "company-1", userId: "removed-1", role: "MEMBER", removedAt: new Date() });

    const approved = verifications.seed({ companyProfileId: "company-1", status: "APPROVED", expiresAt: PAST });

    const useCase = new ExpireCompanyVerificationsUseCase(verifications, companyMembers, auditLog, notifications);
    const result = await useCase.execute(NOW);

    expect(result.expiredCount).toBe(1);
    expect((await verifications.findById(approved.id))?.status).toBe("EXPIRED");

    // Only the two active members are notified, not the removed one.
    expect(notifications.events).toHaveLength(2);
    expect(new Set(notifications.events.map((e) => e.userId))).toEqual(new Set(["owner-1", "admin-1"]));
    expect(notifications.events.every((e) => e.type === "COMPANY_VERIFICATION_EXPIRED")).toBe(true);
  });
});

describe("RunWorkflowExpirationsUseCase", () => {
  it("runs all four batches for a shared `now` and records one summary audit-log entry", async () => {
    const serviceRequests = new FakeServiceRequestRepository();
    const customerProfiles = new FakeCustomerProfileRepository();
    const quotes = new FakeQuoteRepository();
    const professionals = new FakeProfessionalRepository();
    const professionalVerifications = new FakeProfessionalVerificationRepository(professionals);
    const companyVerifications = new FakeCompanyVerificationRepository();
    const companyMembers = new FakeCompanyMembershipRepository();
    const auditLog = new FakeAdminAuditLogRepository();

    const customer = await customerProfiles.findOrCreateByUserId("customer-9");
    serviceRequests.seed({
      id: "req-9",
      customerId: customer.id,
      categoryId: "cat-1",
      categoryName: "Plumbing",
      title: "Fix tap",
      description: "desc",
      status: "PUBLISHED",
      urgency: "MEDIUM",
      budgetMin: null,
      budgetMax: null,
      expiresAt: PAST,
      location: {
        line1: "Calle 1",
        line2: null,
        city: "Oliva",
        province: "Valencia",
        postalCode: "46780",
        country: "ES",
        latitude: null,
        longitude: null,
      },
      photos: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const professional = await professionals.create("pro-9", {});
    await quotes.create({
      serviceRequestId: "req-9",
      professionalProfileId: professional.id,
      submittedByUserId: "pro-9",
      totalAmount: 10,
      currency: "EUR",
      validUntil: PAST,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 10 }],
    });

    const proVerification = await professionalVerifications.create(professional.id);
    await professionalVerifications.updateStatus(proVerification.id, { status: "APPROVED", expiresAt: PAST });

    companyMembers.seed({ companyId: "company-9", userId: "owner-9", role: "OWNER" });
    companyVerifications.seed({ companyProfileId: "company-9", status: "APPROVED", expiresAt: PAST });

    const orchestrator = new RunWorkflowExpirationsUseCase(
      new ExpireServiceRequestsUseCase(serviceRequests, customerProfiles, auditLog),
      new ExpireQuotesUseCase(quotes, professionals, auditLog),
      new ExpireProfessionalVerificationsUseCase(professionalVerifications, professionals, auditLog),
      new ExpireCompanyVerificationsUseCase(companyVerifications, companyMembers, auditLog),
      auditLog,
    );

    const result = await orchestrator.execute(NOW);

    expect(result.serviceRequests.expiredCount).toBe(1);
    expect(result.quotes.expiredCount).toBe(1);
    expect(result.professionalVerifications.expiredCount).toBe(1);
    expect(result.companyVerifications.expiredCount).toBe(1);
    expect(result.totalExpired).toBe(4);

    const summary = auditLog.entries.filter((e) => e.action === "WORKFLOW_EXPIRATION_RUN");
    expect(summary).toHaveLength(1);
    expect(summary[0]?.metadata?.totalExpired).toBe(4);
  });
});
