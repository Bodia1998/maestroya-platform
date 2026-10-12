import { describe, expect, it, vi } from "vitest";

import { AccountErasureExecuted } from "@/domain/events/account-erasure-executed";
import type { LeadPrivacyRetentionRepository } from "@/domain/repositories/lead-privacy-repository";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { ExecuteAccountErasureUseCase, type GdprErasureRepos } from "@/application/use-cases/gdpr/execute-account-erasure.use-case";
import { RecordAccountErasureExecutedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-account-erasure-executed-audit-log.subscriber";
import { FakeAuthTokenRepository } from "../auth/fakes";
import {
  FakeAddressRepository,
  FakeAdminAuditLogRepository,
  FakeCustomerProfileRepository,
  FakeNotificationRepository,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
  FakeUserRepository,
} from "./fakes";

/**
 * Module 158 — the LEAD_V1 step of ExecuteAccountErasureUseCase, with the same fakes as the Module 88 suite (which is left
 * unchanged and keeps passing: the new repository is optional).
 */
function setup(leadPrivacy?: Pick<LeadPrivacyRetentionRepository, "anonymizeRequestsOfErasedCustomers">) {
  const users = new FakeUserRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  const eventBus = new SynchronousEventBus();
  eventBus.subscribe(AccountErasureExecuted, new RecordAccountErasureExecutedAuditLogSubscriber(auditLog));
  const reporter = { report: vi.fn() };
  const repos: GdprErasureRepos = {
    users,
    addresses: new FakeAddressRepository(),
    customerProfiles: new FakeCustomerProfileRepository(),
    professionals: new FakeProfessionalRepository(),
    notifications: new FakeNotificationRepository(),
    professionalVerifications: new FakeProfessionalVerificationRepository(),
    authTokens: new FakeAuthTokenRepository(),
    ...(leadPrivacy ? { leadPrivacy } : {}),
  };
  users.users.set("user-1", { id: "user-1", email: "person@example.com", name: "Ana", passwordHash: "hash", emailVerified: new Date(), status: "ACTIVE" });
  const useCase = new ExecuteAccountErasureUseCase(repos, { deleteByUrl: async () => undefined }, eventBus, reporter);
  return { useCase, auditLog, reporter, users };
}

const actor = { userId: "user-1", isAdmin: false };

describe("M158 — account erasure x LEAD_V1", () => {
  it("anonymizes the user's lead request texts through the optional step, scoped to THIS user, and audits only a count", async () => {
    const anonymize = vi.fn(async () => ({ eligible: 3, anonymized: 3, leadsCancelled: 2 }));
    const t = setup({ anonymizeRequestsOfErasedCustomers: anonymize });
    const result = await t.useCase.execute("user-1", actor);
    expect(anonymize).toHaveBeenCalledWith({ userId: "user-1", limit: 100, dryRun: false });
    expect(result.leadRequestsAnonymized).toBe(3);
    const entry = t.auditLog.entries.find((e) => e.action === "GDPR_DELETION_EXECUTED")!;
    expect(entry.metadata).toMatchObject({ leadRequestsAnonymized: 3 });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/person@example\.com|Ana/);
  });

  it("runs again on an idempotent replay (this is how a crashed earlier execution is completed) and never loops unbounded", async () => {
    const anonymize = vi.fn(async ({ limit }: { limit: number }) => ({ eligible: limit, anonymized: limit, leadsCancelled: 0 }));
    const t = setup({ anonymizeRequestsOfErasedCustomers: anonymize });
    await t.useCase.execute("user-1", actor);
    expect(anonymize).toHaveBeenCalledTimes(10); // bounded: the scheduled sweep finishes any remainder
    anonymize.mockClear();
    const replay = await t.useCase.execute("user-1", actor);
    expect(replay.alreadyErased).toBe(true);
    expect(anonymize).toHaveBeenCalled();
  });

  it("a failing lead step never undoes the erasure and is reported without personal data; the sweep retries it later", async () => {
    const t = setup({ anonymizeRequestsOfErasedCustomers: async () => Promise.reject(new Error("db unavailable")) });
    const result = await t.useCase.execute("user-1", actor);
    expect(result.alreadyErased).toBe(false);
    expect(result.leadRequestsAnonymized).toBeUndefined();
    expect(t.users.users.get("user-1")!.status).toBe("DEACTIVATED");
    expect(t.reporter.report).toHaveBeenCalledTimes(1);
    expect(t.reporter.report.mock.calls[0]![1]).toEqual({ operation: "gdpr_erasure_lead_privacy", userId: "user-1" });
  });

  it("without the optional step the result and the audit metadata are exactly what Module 88 produced", async () => {
    const t = setup();
    const result = await t.useCase.execute("user-1", actor);
    expect("leadRequestsAnonymized" in result).toBe(false);
    const entry = t.auditLog.entries.find((e) => e.action === "GDPR_DELETION_EXECUTED")!;
    expect("leadRequestsAnonymized" in (entry.metadata as object)).toBe(false);
  });

  it("the financial / dispute / audit / consent categories are still RETAIN: the lead step adds no category", async () => {
    const t = setup({ anonymizeRequestsOfErasedCustomers: async () => ({ eligible: 0, anonymized: 0, leadsCancelled: 0 }) });
    const result = await t.useCase.execute("user-1", actor);
    expect(result.categoriesProcessed).toMatchObject({
      MARKETPLACE_FINANCIAL: "RETAIN",
      DISPUTES_AND_SUPPORT: "RETAIN",
      AUDIT_LOG: "RETAIN",
      CONSENT_RECORDS: "RETAIN",
      AFFILIATE_FINANCIAL: "RETAIN",
    });
  });
});
