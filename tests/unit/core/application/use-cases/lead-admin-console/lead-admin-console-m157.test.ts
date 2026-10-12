import { describe, expect, it, vi } from "vitest";

import {
  GetAdminAbuseSubjectUseCase,
  GetAdminLeadDetailUseCase,
  ListAdminLeadClaimsUseCase,
  ListAdminLeadDisputesUseCase,
  ListAdminLeadsUseCase,
  buildLeadAdminTimeline,
} from "@/application/use-cases/lead-admin-console/lead-admin-console.use-cases";
import type { AdminUserRecord } from "@/domain/repositories/admin-repository";
import type { AdminLeadDetailRecord, LeadAdminConsoleReader } from "@/domain/repositories/lead-admin-console-reader";
import { LeadAdminConsoleRejectedError } from "@/domain/services/lead-admin-console";

import { assertNoContactLeak } from "../../../../../test-utils/contact-leak-sentinels";
import { FakeAdminAuditLogRepository } from "../../../../../test-utils/fake-admin-audit-log-repository";

const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const ADMIN = uuid(1);
const NOW = new Date("2026-10-12T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

function admins(record: Partial<AdminUserRecord> | null | "throws" = {}) {
  return {
    getUserById: vi.fn(async (id: string) => {
      if (record === "throws") throw new Error("db down");
      if (record === null) return null;
      return { id, name: null, email: null, phone: null, status: "ACTIVE", roles: ["ADMIN"], hasProfessionalProfile: false, lastLoginAt: null, createdAt: NOW, ...record } as AdminUserRecord;
    }),
  };
}

function detail(over: Partial<AdminLeadDetailRecord> = {}): AdminLeadDetailRecord {
  return {
    lead: {
      id: uuid(10), serviceRequestId: uuid(11), status: "PUBLISHED", requestStatus: "PUBLISHED", flowVersion: "LEAD_V1", maxBuyers: 2,
      createdAt: at("2026-10-01T08:00:00Z"), updatedAt: at("2026-10-01T09:00:00Z"), publishedAt: at("2026-10-01T09:00:00Z"),
      publicationPrice: "12.00", publicationCurrency: "EUR", publicationPricingConfigVersion: "v1", publicationBuyerPolicyVersion: "b1",
      categoryId: uuid(12), categoryName: "Plumbing", city: "Madrid", province: "Madrid", customerUserId: uuid(20),
    },
    purchases: [
      {
        id: uuid(30), professionalProfileId: uuid(31), professionalUserId: uuid(32), status: "DISPUTED", price: "12.00", currency: "EUR", taxAmount: "2.52", totalAmount: "14.52",
        hasPaymentReference: true, createdAt: at("2026-10-02T08:00:00Z"), confirmedAt: at("2026-10-02T08:05:00Z"), failedAt: null, cancelledAt: null, refundedAt: null, revokedAt: null,
      },
    ],
    claims: [
      {
        id: uuid(40), leadPurchaseId: uuid(30), professionalProfileId: uuid(31), reasonCode: "CONTACT_UNREACHABLE", status: "UNDER_REVIEW", description: "Nobody answered the phone at all.",
        evidenceReference: "T-1", submittedAt: at("2026-10-03T08:00:00Z"), respondBy: at("2026-10-06T08:00:00Z"), reviewStartedAt: at("2026-10-03T09:00:00Z"),
        reviewStartedByUserId: ADMIN, decidedAt: null, decidedByUserId: null, decisionExplanation: null,
      },
    ],
    disputes: [
      {
        id: uuid(50), providerDisputeId: "dp_1", leadPurchaseId: uuid(30), status: "NEEDS_RESPONSE", amount: "14.52", currency: "EUR", reason: "fraudulent", evidenceDueBy: at("2026-10-08T00:00:00Z"),
        openedAt: at("2026-10-04T08:00:00Z"), closedAt: null, evidenceStatus: "NOT_SUBMITTED", evidenceReference: null, evidenceRequestedAt: null, evidenceSubmittedAt: null,
      },
    ],
    revocations: [],
    signals: [
      { id: uuid(60), subjectUserId: uuid(32), signalType: "PURCHASE_REJECTED_EVENT", reliability: "HEURISTIC", severity: "LOW", ruleVersion: "m156.v1", targetLeadId: uuid(10), observedCount: null, threshold: null, windowSeconds: null, occurredAt: at("2026-10-02T07:00:00Z") },
    ],
    audit: [
      { id: uuid(70), action: "STATUS_CHANGE", entityType: "LeadQualityClaim", entityId: uuid(40), actorUserId: ADMIN, createdAt: at("2026-10-03T09:00:01Z"), metadata: { adminAction: "LEAD_QUALITY_CLAIM_REVIEW_STARTED", fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW" } },
    ],
    ...over,
  };
}

function reader(over: Partial<Record<keyof LeadAdminConsoleReader, unknown>> = {}) {
  const r = {
    listLeads: vi.fn(async () => []),
    getLeadDetail: vi.fn(async () => detail()),
    listClaims: vi.fn(async () => []),
    listDisputes: vi.fn(async () => []),
    getAbuseSubject: vi.fn(async (id: string) => ({
      subjectUserId: id,
      signals: [{ id: uuid(61), subjectUserId: id, signalType: "PURCHASE_REJECTED_PROBING", reliability: "HEURISTIC", severity: "LOW", ruleVersion: "m156.v1", targetLeadId: null, observedCount: 40, threshold: 10, windowSeconds: 3600, occurredAt: at("2026-10-12T11:00:00Z") }],
      decisions: [
        { id: uuid(80), subjectUserId: id, action: "TEMPORARY_BLOCK", restrictedAction: "LEAD_PURCHASE_INITIATION", status: "ACTIVE", origin: "ADMIN", ruleKey: null, ruleVersion: null, reasonCode: "ADMIN_BLOCK", createdByUserId: ADMIN, decidedAt: at("2026-10-12T10:00:00Z"), expiresAt: at("2026-10-12T14:00:00Z"), explanation: "x", liftedAt: null, liftedByUserId: null, resolutionNote: null },
        { id: uuid(81), subjectUserId: id, action: "TEMPORARY_BLOCK", restrictedAction: "LEAD_PUBLICATION", status: "ACTIVE", origin: "AUTOMATED", ruleKey: "PUBLICATION_BURST", ruleVersion: "m156.v1", reasonCode: "RULE", createdByUserId: null, decidedAt: at("2026-10-12T09:00:00Z"), expiresAt: at("2026-10-12T10:00:00Z"), explanation: null, liftedAt: null, liftedByUserId: null, resolutionNote: null },
        { id: uuid(82), subjectUserId: id, action: "FLAG_FOR_REVIEW", restrictedAction: null, status: "ACTIVE", origin: "AUTOMATED", ruleKey: "REPEATED_REVOCATIONS", ruleVersion: "m156.v1", reasonCode: "RULE", createdByUserId: null, decidedAt: at("2026-10-12T09:00:00Z"), expiresAt: null, explanation: null, liftedAt: null, liftedByUserId: null, resolutionNote: null },
      ],
    })),
    ...over,
  };
  return r as unknown as LeadAdminConsoleReader & typeof r;
}

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(LeadAdminConsoleRejectedError);
    return (e as LeadAdminConsoleRejectedError).reason;
  }
  throw new Error("expected a rejection");
};

describe("M157 — every read re-validates the administrator (server-side authorization)", () => {
  const cases: Array<[string, (a: ReturnType<typeof admins>, r: ReturnType<typeof reader>) => Promise<unknown>]> = [
    ["listLeads", (a, r) => new ListAdminLeadsUseCase(a, r).execute(ADMIN, {})],
    ["leadDetail", (a, r) => new GetAdminLeadDetailUseCase(a, r, () => NOW).execute(ADMIN, uuid(10))],
    ["claims", (a, r) => new ListAdminLeadClaimsUseCase(a, r).execute(ADMIN, {})],
    ["disputes", (a, r) => new ListAdminLeadDisputesUseCase(a, r).execute(ADMIN, {})],
    ["abuseSubject", (a, r) => new GetAdminAbuseSubjectUseCase(a, r, () => NOW).execute(ADMIN, uuid(32))],
  ];
  const denied: Array<[string, Partial<AdminUserRecord> | null | "throws"]> = [
    ["unknown user", null],
    ["a lookup failure (fail closed)", "throws"],
    ["a suspended admin", { status: "SUSPENDED" }],
    ["a banned admin", { status: "BANNED" }],
    ["a SUPPORT agent", { roles: ["SUPPORT"] }],
    ["a customer", { roles: ["CUSTOMER"] }],
    ["a professional", { roles: ["PROVIDER"] }],
    ["a moderator", { roles: ["MODERATOR"] }],
    ["no roles", { roles: [] }],
  ];

  for (const [name, run] of cases) {
    for (const [why, record] of denied) {
      it(`${name}: denied for ${why}, and the reader is never called`, async () => {
        const r = reader();
        expect(await rejection(run(admins(record), r))).toBe("ACTOR_NOT_AUTHORIZED");
        for (const fn of Object.values(r)) expect(fn).not.toHaveBeenCalled();
      });
    }
    it(`${name}: allowed for ADMIN and SUPER_ADMIN`, async () => {
      for (const roles of [["ADMIN"], ["SUPER_ADMIN"], ["SUPPORT", "ADMIN"]]) {
        await expect(run(admins({ roles }), reader())).resolves.toBeDefined();
      }
    });
    it(`${name}: rejects a missing / blank actor id`, async () => {
      for (const bad of ["", "  ", undefined, null]) {
        const r = reader();
        const a = admins();
        await rejection(
          (async () => {
            const uc = { listLeads: new ListAdminLeadsUseCase(a, r) };
            return uc.listLeads.execute(bad as never, {});
          })(),
        );
        expect(a.getUserById).not.toHaveBeenCalled();
      }
    });
  }
});

describe("M157 — input validation", () => {
  it("rejects malformed filters, ids and paging before touching the reader", async () => {
    const bad: Array<Record<string, unknown>> = [
      { status: "NOPE" }, { purchaseStatus: "NOPE" }, { leadId: "not-a-uuid" }, { categoryId: "x" }, { limit: 0 }, { limit: 101 }, { offset: -1 },
      { createdFrom: "garbage" }, { region: "x".repeat(101) }, { city: "a\u0007" },
      { createdFrom: "2026-10-02", createdTo: "2026-10-01" },
    ];
    for (const input of bad) {
      const r = reader();
      expect(await rejection(new ListAdminLeadsUseCase(admins(), r).execute(ADMIN, input))).toBe("INVALID_INPUT");
      expect(r.listLeads).not.toHaveBeenCalled();
    }
  });

  it("passes only normalized, bounded filters to the reader", async () => {
    const r = reader();
    await new ListAdminLeadsUseCase(admins(), r).execute(ADMIN, { status: "PUBLISHED", purchaseStatus: "DISPUTED", leadId: uuid(10).toUpperCase(), region: " Madrid ", createdFrom: "2026-10-01", limit: 50, offset: 100 });
    expect(r.listLeads).toHaveBeenCalledWith({
      leadId: uuid(10), status: "PUBLISHED", purchaseStatus: "DISPUTED", categoryId: undefined, region: "Madrid", city: undefined,
      createdFrom: new Date("2026-10-01T00:00:00.000Z"), createdTo: undefined, limit: 50, offset: 100,
    });
  });

  it("queue use cases validate status and paging", async () => {
    for (const input of [{ status: "NOPE" }, { limit: 500 }, { offset: 1e9 }]) {
      expect(await rejection(new ListAdminLeadClaimsUseCase(admins(), reader()).execute(ADMIN, input))).toBe("INVALID_INPUT");
      expect(await rejection(new ListAdminLeadDisputesUseCase(admins(), reader()).execute(ADMIN, input))).toBe("INVALID_INPUT");
    }
    const r = reader();
    await new ListAdminLeadClaimsUseCase(admins(), r).execute(ADMIN, {});
    expect(r.listClaims).toHaveBeenCalledWith({ status: undefined, limit: 20, offset: 0 });
  });

  it("a malformed lead / subject id is INVALID_INPUT; a missing one is a closed not-found answer", async () => {
    expect(await rejection(new GetAdminLeadDetailUseCase(admins(), reader()).execute(ADMIN, "nope"))).toBe("INVALID_INPUT");
    expect(await rejection(new GetAdminLeadDetailUseCase(admins(), reader({ getLeadDetail: vi.fn(async () => null) })).execute(ADMIN, uuid(10)))).toBe("LEAD_NOT_FOUND");
    expect(await rejection(new GetAdminAbuseSubjectUseCase(admins(), reader()).execute(ADMIN, "nope"))).toBe("INVALID_INPUT");
    expect(await rejection(new GetAdminAbuseSubjectUseCase(admins(), reader({ getAbuseSubject: vi.fn(async () => null) })).execute(ADMIN, uuid(32)))).toBe("SUBJECT_NOT_FOUND");
  });
});

describe("M157 — lead investigation view", () => {
  it("separates recorded facts, audit entries, derived indicators and heuristic signals", async () => {
    const view = await new GetAdminLeadDetailUseCase(admins(), reader(), () => NOW).execute(ADMIN, uuid(10));
    const bases = new Set(view.timeline.map((e) => e.basis));
    expect(bases).toEqual(new Set(["RECORDED_FACT", "AUDIT_ENTRY", "HEURISTIC_SIGNAL"]));
    expect(view.indicators.every((i) => i.basis === "DERIVED")).toBe(true);
    expect(view.indicators.map((i) => i.code).sort()).toEqual(
      ["ACCESS_SUSPENDED_BY_DISPUTE", "CLAIM_RESPONSE_TARGET_PASSED", "DISPUTE_EVIDENCE_DUE_PASSED"].sort(),
    );
    expect(view.generatedAt).toEqual(NOW);
  });

  it("orders the timeline oldest first and reports who did what", async () => {
    const view = await new GetAdminLeadDetailUseCase(admins(), reader(), () => NOW).execute(ADMIN, uuid(10));
    const times = view.timeline.map((e) => e.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const started = view.timeline.filter((e) => e.code === "CLAIM_REVIEW_STARTED")[0];
    expect(started).toMatchObject({ basis: "RECORDED_FACT", actorUserId: ADMIN, fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW" });
    const audit = view.timeline.find((e) => e.basis === "AUDIT_ENTRY");
    expect(audit).toMatchObject({ code: "LEAD_QUALITY_CLAIM_REVIEW_STARTED", fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW" });
  });

  it("is deterministic: the same facts always yield the same timeline", () => {
    expect(buildLeadAdminTimeline(detail())).toEqual(buildLeadAdminTimeline(detail()));
  });

  it("marks PURCHASE_REJECTED_PROBING / PURCHASE_REJECTED_EVENT as record-only and others as not", async () => {
    const r = reader({
      getLeadDetail: vi.fn(async () =>
        detail({
          signals: [
            { id: uuid(62), subjectUserId: uuid(32), signalType: "PURCHASE_REJECTED_PROBING", reliability: "HEURISTIC", severity: "LOW", ruleVersion: "m156.v1", targetLeadId: null, observedCount: 11, threshold: 10, windowSeconds: 3600, occurredAt: NOW },
            { id: uuid(63), subjectUserId: uuid(32), signalType: "CONTACT_ACCESS_DENIED_PROBING", reliability: "HEURISTIC", severity: "MEDIUM", ruleVersion: "m156.v1", targetLeadId: null, observedCount: 5, threshold: 5, windowSeconds: 3600, occurredAt: NOW },
          ],
        }),
      ),
    });
    const view = await new GetAdminLeadDetailUseCase(admins(), r, () => NOW).execute(ADMIN, uuid(10));
    expect(Object.fromEntries(view.signals.map((s) => [s.signalType, s.recordOnly]))).toEqual({ PURCHASE_REJECTED_PROBING: true, CONTACT_ACCESS_DENIED_PROBING: false });
  });

  it("exposes no contact data: no private contact key anywhere (the customer id is an opaque id, explicitly allowed)", async () => {
    const view = await new GetAdminLeadDetailUseCase(admins(), reader(), () => NOW).execute(ADMIN, uuid(10));
    expect(() => assertNoContactLeak(view, [], ["customerUserId"])).not.toThrow();
    const json = JSON.stringify(view);
    for (const forbidden of ["paymentReference", "evidenceText", "providerChargeId", "email", "phone", "line1", "title"]) {
      expect(json, forbidden).not.toContain(`"${forbidden}"`);
    }
  });
});

describe("M157 — abuse subject view", () => {
  it("derives 'restricting now' only for an ACTIVE, unexpired block; a flag never restricts", async () => {
    const view = await new GetAdminAbuseSubjectUseCase(admins(), reader(), () => NOW).execute(ADMIN, uuid(32));
    expect(Object.fromEntries(view.decisions.map((d) => [d.id, d.restrictingNow]))).toEqual({ [uuid(80)]: true, [uuid(81)]: false, [uuid(82)]: false });
    expect(view.signals[0]).toMatchObject({ signalType: "PURCHASE_REJECTED_PROBING", recordOnly: true });
  });
});

describe("M157 — reads cannot mutate state", () => {
  it("the reader port has only read methods and the audit trail is never touched by a read", async () => {
    const audit = new FakeAdminAuditLogRepository();
    const r = reader();
    const a = admins();
    await new ListAdminLeadsUseCase(a, r).execute(ADMIN, {});
    await new GetAdminLeadDetailUseCase(a, r, () => NOW).execute(ADMIN, uuid(10));
    await new ListAdminLeadClaimsUseCase(a, r).execute(ADMIN, {});
    await new ListAdminLeadDisputesUseCase(a, r).execute(ADMIN, {});
    await new GetAdminAbuseSubjectUseCase(a, r, () => NOW).execute(ADMIN, uuid(32));
    expect(Object.keys(r).sort()).toEqual(["getAbuseSubject", "getLeadDetail", "listClaims", "listDisputes", "listLeads"]);
    expect(audit.entries).toHaveLength(0);
    // the administrator lookup is the only other call, and it is a read
    expect(Object.keys(a)).toEqual(["getUserById"]);
  });
});
