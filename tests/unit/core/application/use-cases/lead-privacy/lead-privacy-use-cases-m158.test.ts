import { describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/domain/errors/domain-error";
import type { RecordAdminAuditLogData } from "@/domain/repositories/admin-audit-log-repository";
import type {
  LeadContactSharingRecordData,
  LeadContactSharingRepository,
  LeadPrivacyRetentionRepository,
  LeadRequestAnonymizationResult,
} from "@/domain/repositories/lead-privacy-repository";
import type { LeadStatus } from "@/domain/services/lead";
import {
  LeadContactSharingNotApplicableError,
  LeadContactSharingRecordNotFoundError,
  LeadPrivacyPolicyNotConfiguredError,
  UNCONFIGURED_LEAD_PRIVACY_POLICY,
  type LeadPrivacyPolicy,
} from "@/domain/services/lead-privacy";
import { RecordLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/record-lead-contact-sharing.use-case";
import { RunLeadPrivacyRetentionUseCase } from "@/application/use-cases/lead-privacy/run-lead-privacy-retention.use-case";
import { WithdrawLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/withdraw-lead-contact-sharing.use-case";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_PROFILE = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-10-12T10:00:00.000Z");

class FakeSharing implements LeadContactSharingRepository {
  rows = new Map<string, LeadContactSharingRecordData>();
  async record(data: Parameters<LeadContactSharingRepository["record"]>[0]) {
    const existing = this.rows.get(data.leadId);
    if (existing) return { record: existing, created: false };
    const record: LeadContactSharingRecordData = { id: `r-${this.rows.size + 1}`, ...data, withdrawnAt: null };
    this.rows.set(data.leadId, record);
    return { record, created: true };
  }
  async findByLeadId(leadId: string) {
    return this.rows.get(leadId) ?? null;
  }
  async withdraw(leadId: string, at: Date) {
    const row = this.rows.get(leadId);
    if (!row) return { record: null, changed: false };
    if (row.basis !== "CONSENT" || row.withdrawnAt) return { record: row, changed: false };
    const next = { ...row, withdrawnAt: at };
    this.rows.set(leadId, next);
    return { record: next, changed: true };
  }
  async listByUser(userId: string) {
    return [...this.rows.values()].filter((r) => r.userId === userId);
  }
}

function setup(opts: { leadStatus?: LeadStatus; policy?: LeadPrivacyPolicy } = {}) {
  let leadStatus: LeadStatus = opts.leadStatus ?? "PUBLISHED";
  const audit: RecordAdminAuditLogData[] = [];
  const statusWrites: Array<{ id: string; status: string }> = [];
  const sharing = new FakeSharing();
  const deps = {
    leads: {
      findById: async (id: string) =>
        id === LEAD_ID ? { id: LEAD_ID, serviceRequestId: REQUEST_ID, status: leadStatus, flowVersion: "LEAD_V1" as const } : null,
    },
    serviceRequests: {
      findById: async (id: string) => (id === REQUEST_ID ? { id: REQUEST_ID, customerId: CUSTOMER_PROFILE, status: "PUBLISHED" } : null),
      updateStatus: async (id: string, status: string) => {
        statusWrites.push({ id, status });
        if (status === "CANCELLED") leadStatus = "CANCELLED";
      },
    },
    customerProfiles: { findByUserId: async (userId: string) => (userId === OWNER ? { id: CUSTOMER_PROFILE } : userId === OTHER ? { id: "other-profile" } : null) },
    sharing,
    auditLog: { record: async (d: RecordAdminAuditLogData) => void audit.push(d) },
  };
  const policy: LeadPrivacyPolicy = opts.policy ?? { contactSharingBasis: "CONSENT", noticeVersion: "notice-v1", requestContentRetentionDays: null };
  return {
    deps,
    audit,
    statusWrites,
    sharing,
    record: new RecordLeadContactSharingUseCase(deps as never, policy, undefined, () => NOW),
    withdraw: new WithdrawLeadContactSharingUseCase(deps as never, undefined, () => NOW),
  };
}

describe("M158 — RecordLeadContactSharingUseCase", () => {
  it("refuses to invent a basis while the policy is undecided", async () => {
    const t = setup({ policy: UNCONFIGURED_LEAD_PRIVACY_POLICY });
    await expect(t.record.execute(OWNER, LEAD_ID)).rejects.toBeInstanceOf(LeadPrivacyPolicyNotConfiguredError);
    expect(t.sharing.rows.size).toBe(0);
  });

  it("refuses when the policy names a basis but no notice version", async () => {
    const t = setup({ policy: { contactSharingBasis: "CONSENT", noticeVersion: null, requestContentRetentionDays: null } });
    await expect(t.record.execute(OWNER, LEAD_ID)).rejects.toBeInstanceOf(LeadPrivacyPolicyNotConfiguredError);
  });

  it("records the SERVER policy's basis/version (never client-chosen), with a PII-free audit entry for a consent", async () => {
    const t = setup();
    const result = await t.record.execute(OWNER, LEAD_ID);
    expect(result).toEqual({ created: true, basis: "CONSENT", noticeVersion: "notice-v1" });
    expect(t.sharing.rows.get(LEAD_ID)).toMatchObject({ userId: OWNER, basis: "CONSENT", noticeVersion: "notice-v1", recordedAt: NOW, withdrawnAt: null });
    expect(t.audit).toEqual([
      {
        adminUserId: OWNER,
        action: "GDPR_CONSENT_GRANTED",
        targetType: "Lead",
        targetId: LEAD_ID,
        metadata: { purpose: "LEAD_CONTACT_SHARING", basis: "CONSENT", noticeVersion: "notice-v1" },
      },
    ]);
  });

  it("is idempotent: a repeat keeps the original evidence and writes no second audit entry", async () => {
    const t = setup();
    await t.record.execute(OWNER, LEAD_ID);
    const again = await t.record.execute(OWNER, LEAD_ID);
    expect(again.created).toBe(false);
    expect(t.sharing.rows.size).toBe(1);
    expect(t.audit).toHaveLength(1);
  });

  it("a withdrawn consent is NOT revived by recording again", async () => {
    const t = setup();
    await t.record.execute(OWNER, LEAD_ID);
    await t.withdraw.execute(OWNER, LEAD_ID);
    await t.record.execute(OWNER, LEAD_ID).catch(() => undefined); // lead is cancelled now -> refused, and in any case:
    expect(t.sharing.rows.get(LEAD_ID)!.withdrawnAt).not.toBeNull();
  });

  it("a notice under another basis is stored as notice evidence and is not audited as a consent", async () => {
    const t = setup({ policy: { contactSharingBasis: "OTHER_LAWFUL_BASIS", noticeVersion: "notice-v1", requestContentRetentionDays: null } });
    await t.record.execute(OWNER, LEAD_ID);
    expect(t.sharing.rows.get(LEAD_ID)!.basis).toBe("OTHER_LAWFUL_BASIS");
    expect(t.audit).toEqual([]);
  });

  it("cross-user isolation: someone else's lead, a non-customer, a malformed or unknown id are one indistinguishable NotFound", async () => {
    const t = setup();
    for (const [user, lead] of [
      [OTHER, LEAD_ID],
      ["no-profile-user", LEAD_ID],
      [OWNER, "not-a-uuid"],
      [OWNER, "99999999-9999-4999-8999-999999999999"],
      ["", LEAD_ID],
    ] as const) {
      const error = await t.record.execute(user, lead).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as Error).message).toBe('Lead with id "requested" was not found.');
    }
    expect(t.sharing.rows.size).toBe(0);
  });

  it.each(["CLOSED", "EXPIRED", "CANCELLED"] as const)("a %s lead no longer takes a new choice", async (leadStatus) => {
    const t = setup({ leadStatus });
    await expect(t.record.execute(OWNER, LEAD_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an audit-trail failure never loses the evidence nor surfaces to the customer", async () => {
    const t = setup();
    const reporter = { report: vi.fn() };
    const failing = new RecordLeadContactSharingUseCase(
      { ...t.deps, auditLog: { record: async () => Promise.reject(new Error("audit down")) } } as never,
      { contactSharingBasis: "CONSENT", noticeVersion: "notice-v1", requestContentRetentionDays: null },
      reporter,
      () => NOW,
    );
    await expect(failing.execute(OWNER, LEAD_ID)).resolves.toMatchObject({ created: true });
    expect(t.sharing.rows.size).toBe(1);
    expect(reporter.report).toHaveBeenCalledTimes(1);
  });
});

describe("M158 — WithdrawLeadContactSharingUseCase", () => {
  it("withdraws a consent: stamps it, takes the lead off the market via the central request cancellation, audits without PII", async () => {
    const t = setup();
    await t.record.execute(OWNER, LEAD_ID);
    t.audit.length = 0;

    const result = await t.withdraw.execute(OWNER, LEAD_ID);
    expect(result).toEqual({ changed: true, leadOffMarket: true });
    expect(t.sharing.rows.get(LEAD_ID)!.withdrawnAt).toEqual(NOW);
    expect(t.statusWrites).toEqual([{ id: REQUEST_ID, status: "CANCELLED" }]);
    expect(t.audit).toEqual([
      {
        adminUserId: OWNER,
        action: "GDPR_CONSENT_WITHDRAWN",
        targetType: "Lead",
        targetId: LEAD_ID,
        metadata: { purpose: "LEAD_CONTACT_SHARING", basis: "CONSENT", noticeVersion: "notice-v1" },
      },
    ]);
  });

  it("is idempotent and retry-safe: a repeat changes nothing, writes no second audit entry and no second cancellation", async () => {
    const t = setup();
    await t.record.execute(OWNER, LEAD_ID);
    await t.withdraw.execute(OWNER, LEAD_ID);
    t.audit.length = 0;
    const again = await t.withdraw.execute(OWNER, LEAD_ID);
    expect(again).toEqual({ changed: false, leadOffMarket: true });
    expect(t.audit).toEqual([]);
    expect(t.statusWrites).toHaveLength(1);
  });

  it("completes a half-done withdrawal on retry (stamped, but the cancellation had not happened)", async () => {
    const t = setup();
    await t.record.execute(OWNER, LEAD_ID);
    await t.sharing.withdraw(LEAD_ID, NOW); // crash after step 1
    const result = await t.withdraw.execute(OWNER, LEAD_ID);
    expect(result).toEqual({ changed: false, leadOffMarket: true });
    expect(t.statusWrites).toEqual([{ id: REQUEST_ID, status: "CANCELLED" }]);
  });

  it("no record => explicit not-found; a notice under another basis => explicitly not applicable", async () => {
    const none = setup();
    await expect(none.withdraw.execute(OWNER, LEAD_ID)).rejects.toBeInstanceOf(LeadContactSharingRecordNotFoundError);

    const notice = setup({ policy: { contactSharingBasis: "OTHER_LAWFUL_BASIS", noticeVersion: "n", requestContentRetentionDays: null } });
    await notice.record.execute(OWNER, LEAD_ID);
    await expect(notice.withdraw.execute(OWNER, LEAD_ID)).rejects.toBeInstanceOf(LeadContactSharingNotApplicableError);
    expect(notice.statusWrites).toEqual([]);
  });

  it("only the owner can withdraw", async () => {
    const t = setup();
    await t.record.execute(OWNER, LEAD_ID);
    await expect(t.withdraw.execute(OTHER, LEAD_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(t.sharing.rows.get(LEAD_ID)!.withdrawnAt).toBeNull();
    expect(t.statusWrites).toEqual([]);
  });

  it("an already terminal lead is not cancelled again", async () => {
    const t = setup();
    await t.record.execute(OWNER, LEAD_ID);
    const closed = new WithdrawLeadContactSharingUseCase(
      { ...t.deps, leads: { findById: async () => ({ id: LEAD_ID, serviceRequestId: REQUEST_ID, status: "CLOSED", flowVersion: "LEAD_V1" }) } } as never,
      undefined,
      () => NOW,
    );
    expect(await closed.execute(OWNER, LEAD_ID)).toEqual({ changed: true, leadOffMarket: true });
    expect(t.statusWrites).toEqual([]);
  });
});

describe("M158 — RunLeadPrivacyRetentionUseCase", () => {
  const ZERO: LeadRequestAnonymizationResult = { eligible: 0, anonymized: 0, leadsCancelled: 0 };

  function repo(patch: Partial<LeadPrivacyRetentionRepository> = {}): LeadPrivacyRetentionRepository & {
    erased: ReturnType<typeof vi.fn>;
    minimize: ReturnType<typeof vi.fn>;
  } {
    const erased = vi.fn(async () => ZERO);
    const minimize = vi.fn(async () => ZERO);
    return {
      anonymizeRequestsOfErasedCustomers: erased,
      minimizeTerminalLeadRequestContent: minimize,
      countOpenLeadsWithoutContactSharingRecord: async () => 7,
      ...patch,
      erased,
      minimize,
    } as never;
  }
  const policy = (days: number | null): LeadPrivacyPolicy => ({ contactSharingBasis: null, noticeVersion: null, requestContentRetentionDays: days });
  const audit = () => {
    const entries: RecordAdminAuditLogData[] = [];
    return { entries, log: { record: async (d: RecordAdminAuditLogData) => void entries.push(d) } as never };
  };

  it("rejects an out-of-range batch size", async () => {
    const a = audit();
    const uc = new RunLeadPrivacyRetentionUseCase(repo(), policy(null), a.log);
    for (const batchSize of [0, -1, 501, 1.5, Number.NaN]) {
      await expect(uc.execute({ batchSize, dryRun: false })).rejects.toThrow("Batch size is out of range.");
    }
  });

  it("no approved period: minimization examines nothing and says POLICY_NOT_CONFIGURED; erasure follow-through still runs", async () => {
    const r = repo();
    const a = audit();
    const result = await new RunLeadPrivacyRetentionUseCase(r, policy(null), a.log).execute({ batchSize: 50, dryRun: false });
    expect(r.erased).toHaveBeenCalledTimes(1);
    expect(r.minimize).not.toHaveBeenCalled();
    expect(result.terminalRequestMinimization.status).toBe("POLICY_NOT_CONFIGURED");
    expect(result.policy).toEqual({ contactSharingBasisConfigured: false, noticeVersionConfigured: false, retentionPeriodConfigured: false });
    expect(result.openLeadsWithoutContactSharingRecord).toBe(7);
    expect(result.outcome).toBe("completed");
  });

  it("passes the exact cutoff derived from the configured period (boundary included by the repository)", async () => {
    const r = repo();
    const a = audit();
    await new RunLeadPrivacyRetentionUseCase(r, policy(30), a.log, null, undefined, () => NOW).execute({ batchSize: 10, dryRun: true });
    expect(r.minimize).toHaveBeenCalledWith({ limit: 10, dryRun: true, cutoff: new Date("2026-09-12T10:00:00.000Z") });
  });

  it("a dry run writes nothing: no audit entry, and exactly one batch", async () => {
    const r = repo({ anonymizeRequestsOfErasedCustomers: vi.fn(async () => ({ eligible: 50, anonymized: 0, leadsCancelled: 3 })) });
    const a = audit();
    const result = await new RunLeadPrivacyRetentionUseCase(r, policy(null), a.log).execute({ batchSize: 50, dryRun: true });
    expect(r.anonymizeRequestsOfErasedCustomers).toHaveBeenCalledTimes(1);
    expect(a.entries).toEqual([]);
    expect(result.dryRun).toBe(true);
  });

  it("processes full batches up to a hard bound, records ONE PII-free audit entry, and a finished run repeats as a silent no-op", async () => {
    let remaining = 120;
    const r = repo({
      anonymizeRequestsOfErasedCustomers: vi.fn(async ({ limit }: { limit: number }) => {
        const n = Math.min(limit, remaining);
        remaining -= n;
        return { eligible: n, anonymized: n, leadsCancelled: n };
      }),
    });
    const a = audit();
    const uc = new RunLeadPrivacyRetentionUseCase(r, policy(null), a.log);
    const first = await uc.execute({ batchSize: 50, dryRun: false });
    expect(first.erasedCustomerRequests).toEqual({ eligible: 120, anonymized: 120, leadsCancelled: 120 });
    expect(a.entries).toHaveLength(1);
    expect(a.entries[0]).toMatchObject({
      adminUserId: null,
      action: "GDPR_DELETION_EXECUTED",
      targetType: "LeadPrivacyRetentionRun",
      metadata: { mode: "AUTOMATED_LEAD_PRIVACY_RETENTION", erasedCustomerRequestsAnonymized: 120, leadsCancelled: 120, terminalRequestsMinimized: 0, retentionDays: null },
    });
    const second = await uc.execute({ batchSize: 50, dryRun: false });
    expect(second.erasedCustomerRequests.anonymized).toBe(0);
    expect(a.entries).toHaveLength(1);
  });

  it("never runs more than the bounded number of batches per phase", async () => {
    const r = repo({ anonymizeRequestsOfErasedCustomers: vi.fn(async ({ limit }: { limit: number }) => ({ eligible: limit, anonymized: limit, leadsCancelled: 0 })) });
    await new RunLeadPrivacyRetentionUseCase(r, policy(null), audit().log).execute({ batchSize: 5, dryRun: false });
    expect(r.anonymizeRequestsOfErasedCustomers).toHaveBeenCalledTimes(10);
  });

  it("a concurrent run (lock held) is skipped without touching the repository", async () => {
    const r = repo();
    const lock = { withLock: async () => null };
    const result = await new RunLeadPrivacyRetentionUseCase(r, policy(30), audit().log, lock as never).execute({ batchSize: 5, dryRun: false });
    expect(result.outcome).toBe("skipped_locked");
    expect(r.erased).not.toHaveBeenCalled();
    expect(r.minimize).not.toHaveBeenCalled();
  });

  it("a failing phase is reported (value-free) and isolated: the other phase still runs, the run says it failed", async () => {
    const secret = "customer-email@example.invalid";
    const reporter = { report: vi.fn() };
    const r = repo({ anonymizeRequestsOfErasedCustomers: vi.fn(async () => Promise.reject(new Error(`boom ${secret}`))) });
    const a = audit();
    const result = await new RunLeadPrivacyRetentionUseCase(r, policy(30), a.log, null, reporter, () => NOW).execute({ batchSize: 5, dryRun: false });
    expect(result.outcome).toBe("completed_with_failures");
    expect(result.failedPhases).toEqual(["ERASED_CUSTOMER_REQUESTS"]);
    expect(r.minimize).toHaveBeenCalledTimes(1);
    expect(reporter.report).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(reporter.report.mock.calls[0]![1])).toEqual('{"operation":"lead_privacy_retention","phase":"ERASED_CUSTOMER_REQUESTS"}');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("an audit failure after real changes is surfaced as a failed AUDIT phase", async () => {
    const r = repo({ anonymizeRequestsOfErasedCustomers: vi.fn(async () => ({ eligible: 1, anonymized: 1, leadsCancelled: 0 })) });
    const result = await new RunLeadPrivacyRetentionUseCase(r, policy(null), { record: async () => Promise.reject(new Error("x")) } as never).execute({
      batchSize: 5,
      dryRun: false,
    });
    expect(result.failedPhases).toEqual(["AUDIT"]);
    expect(result.outcome).toBe("completed_with_failures");
  });
});
