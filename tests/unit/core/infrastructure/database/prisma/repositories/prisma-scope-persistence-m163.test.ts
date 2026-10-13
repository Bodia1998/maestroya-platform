import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SNAPSHOT_DATA } from "../../../../../../test-utils/lead-publication-fixtures";

/** Module 163 — Prisma persistence of structured scope (request, publication snapshot, reader). Mocked client; no database. */
const address = { create: vi.fn() };
const serviceRequest = { create: vi.fn() };
const lead = { updateMany: vi.fn(), findUnique: vi.fn() };
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: { address, serviceRequest, lead } }));

const now = new Date("2026-10-03T10:00:00Z");
const addr = { line1: "l", line2: null, city: "c", province: null, postalCode: "p", country: "ES", latitude: null, longitude: null };
const srRow = { id: "sr-1", customerId: "c", categoryId: "cat", title: "t", description: "d", status: "PUBLISHED", urgency: "MEDIUM", budgetMin: null, budgetMax: null, expiresAt: null, createdAt: now, updatedAt: now, category: { name: "n", slug: "s" }, address: addr, photos: [] };
const data = { categoryId: "cat", title: "t", description: "d", urgency: "MEDIUM" as const, budgetMin: null, budgetMax: null, location: addr };
const SCOPE = { questionnaireVersion: "test-scope-v1", answers: { size: "large", rooms: 3 } };

describe("PrismaServiceRequestRepository.create — structured scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    address.create.mockResolvedValue({ id: "addr" });
    serviceRequest.create.mockResolvedValue(srRow);
  });
  const repo = async () => new (await import("@/infrastructure/database/prisma/repositories/prisma-service-request-repository")).PrismaServiceRequestRepository();

  it("writes answers and version together on a LEAD_V1 request", async () => {
    await (await repo()).create("c", "u", { ...data, flowVersion: "LEAD_V1", scope: SCOPE });
    expect(serviceRequest.create.mock.calls[0]![0].data).toMatchObject({ scopeAnswers: SCOPE.answers, scopeQuestionnaireVersion: "test-scope-v1", flowVersion: "LEAD_V1" });
  });

  it.each([[undefined], [null]])("scope %j writes no scope columns at all (legacy and unscoped LEAD_V1 rows are unchanged)", async (scope) => {
    await (await repo()).create("c", "u", { ...data, flowVersion: "LEAD_V1", scope });
    const written = serviceRequest.create.mock.calls[0]![0].data;
    expect(written).not.toHaveProperty("scopeAnswers");
    expect(written).not.toHaveProperty("scopeQuestionnaireVersion");
  });

  it("refuses scope on a legacy request, before any row is written", async () => {
    await expect((await repo()).create("c", "u", { ...data, scope: SCOPE })).rejects.toThrow(/LEAD_V1/);
    await expect((await repo()).create("c", "u", { ...data, flowVersion: "LEGACY_QUOTE_PAYMENT", scope: SCOPE })).rejects.toThrow(/LEAD_V1/);
    expect(address.create).not.toHaveBeenCalled();
    expect(serviceRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    ["empty answers", { questionnaireVersion: "v1", answers: {} }],
    ["bad version", { questionnaireVersion: "Bad Version!", answers: { a: "b" } }],
    ["nested value", { questionnaireVersion: "v1", answers: { a: { b: 1 } } }],
    ["array answers", { questionnaireVersion: "v1", answers: ["x"] }],
    ["float answer", { questionnaireVersion: "v1", answers: { a: 1.5 } }],
  ])("refuses malformed provenance (%s) before any row is written", async (_l, scope) => {
    await expect((await repo()).create("c", "u", { ...data, flowVersion: "LEAD_V1", scope: scope as never })).rejects.toThrow(/malformed/);
    expect(address.create).not.toHaveBeenCalled();
  });
});

const lrow = (patch: Record<string, unknown> = {}) => ({
  id: "lead-1", serviceRequestId: "sr-1", status: "PUBLISHED", maxBuyers: 2, createdAt: now, updatedAt: now, serviceRequest: { flowVersion: "LEAD_V1" }, publishedAt: now,
  publicationPrice: new Prisma.Decimal("18"), publicationCurrency: "EUR", publicationEstimatedJobValue: new Prisma.Decimal("150.5"), publicationPricingRate: new Prisma.Decimal("0.12"),
  publicationPricingConfidence: "LOW", publicationPricingConfigVersion: "lead-pricing-test-config-v1", publicationJobValueRuleVersion: "job-value-test-v1",
  publicationPricingRuleVersion: "lead-pricing-test-v1", publicationBuyerPolicyVersion: "lead-buyer-policy-test-v1",
  publicationScopeQuestionnaireVersion: null, publicationScopeAnswers: null, ...patch,
});

describe("PrismaLeadRepository — scope provenance in the publication snapshot", () => {
  beforeEach(() => vi.clearAllMocks());
  const repo = async () => new (await import("@/infrastructure/database/prisma/repositories/prisma-lead-repository")).PrismaLeadRepository();

  it("publish writes the provenance in the SAME conditional updateMany as the rest of the snapshot", async () => {
    lead.updateMany.mockResolvedValue({ count: 1 });
    lead.findUnique.mockResolvedValue(lrow({ publicationScopeQuestionnaireVersion: "test-scope-v1", publicationScopeAnswers: { size: "large" } }));
    const result = await (await repo()).publish("lead-1", { ...SNAPSHOT_DATA, scopeQuestionnaireVersion: "test-scope-v1", scopeAnswers: { size: "large" } });
    expect(lead.updateMany).toHaveBeenCalledTimes(1);
    expect(lead.updateMany.mock.calls[0]![0].data).toMatchObject({ publicationScopeQuestionnaireVersion: "test-scope-v1", publicationScopeAnswers: { size: "large" }, status: "PUBLISHED" });
    expect(result?.publication).toMatchObject({ scopeQuestionnaireVersion: "test-scope-v1", scopeAnswers: { size: "large" } });
  });

  it("publish without scope writes no scope columns (M133 snapshot shape unchanged)", async () => {
    lead.updateMany.mockResolvedValue({ count: 1 });
    lead.findUnique.mockResolvedValue(lrow());
    const result = await (await repo()).publish("lead-1", SNAPSHOT_DATA);
    const written = lead.updateMany.mock.calls[0]![0].data;
    expect(written).not.toHaveProperty("publicationScopeAnswers");
    expect(written).not.toHaveProperty("publicationScopeQuestionnaireVersion");
    expect(result?.publication).not.toHaveProperty("scopeAnswers");
    expect(result?.publication).toEqual({ ...SNAPSHOT_DATA, estimatedJobValue: "150.50", publishedAt: now });
  });

  it.each([
    ["half provenance (version only)", { scopeQuestionnaireVersion: "test-scope-v1" }],
    ["half provenance (answers only)", { scopeAnswers: { a: "b" } }],
    ["empty answers", { scopeQuestionnaireVersion: "test-scope-v1", scopeAnswers: {} }],
    ["nested answers", { scopeQuestionnaireVersion: "test-scope-v1", scopeAnswers: { a: { b: 1 } } }],
  ])("publish rejects a malformed snapshot (%s) BEFORE any write", async (_l, extra) => {
    await expect((await repo()).publish("lead-1", { ...SNAPSHOT_DATA, ...extra } as never)).rejects.toMatchObject({ code: "LEAD_PUBLICATION_REJECTED", reason: "SNAPSHOT_INVALID" });
    expect(lead.updateMany).not.toHaveBeenCalled();
  });

  it("a half-stored provenance is corruption, never 'no scope'", async () => {
    lead.findUnique.mockResolvedValue(lrow({ publicationScopeQuestionnaireVersion: "test-scope-v1" }));
    await expect((await repo()).findById("lead-1")).rejects.toThrow(/incomplete scope provenance/);
  });

  it("a stored provenance that fails structural validation is rejected on read", async () => {
    lead.findUnique.mockResolvedValue(lrow({ publicationScopeQuestionnaireVersion: "test-scope-v1", publicationScopeAnswers: { a: { nested: true } } }));
    await expect((await repo()).findById("lead-1")).rejects.toThrow(/invalid publication snapshot/);
  });
});

describe("PrismaLeadScopeAnswersReader", () => {
  beforeEach(() => vi.clearAllMocks());
  const reader = async () => new (await import("@/infrastructure/database/prisma/repositories/prisma-lead-scope-answers-reader")).PrismaLeadScopeAnswersReader();

  it("selects ONLY the two scope columns", async () => {
    lead.findUnique.mockResolvedValue({ serviceRequest: { scopeAnswers: { size: "large" }, scopeQuestionnaireVersion: "test-scope-v1" } });
    expect(await (await reader()).findByLeadId("lead-1")).toEqual({ questionnaireVersion: "test-scope-v1", answers: { size: "large" } });
    expect(lead.findUnique.mock.calls[0]![0]).toEqual({ where: { id: "lead-1" }, select: { serviceRequest: { select: { scopeAnswers: true, scopeQuestionnaireVersion: true } } } });
  });

  it("returns null for a missing lead or a request without scope", async () => {
    lead.findUnique.mockResolvedValueOnce(null);
    expect(await (await reader()).findByLeadId("x")).toBeNull();
    lead.findUnique.mockResolvedValueOnce({ serviceRequest: { scopeAnswers: null, scopeQuestionnaireVersion: null } });
    expect(await (await reader()).findByLeadId("x")).toBeNull();
  });

  it("a half-present pair is corruption and throws (never 'no scope')", async () => {
    lead.findUnique.mockResolvedValue({ serviceRequest: { scopeAnswers: { a: "b" }, scopeQuestionnaireVersion: null } });
    await expect((await reader()).findByLeadId("x")).rejects.toThrow(/incomplete stored scope/);
  });
});
