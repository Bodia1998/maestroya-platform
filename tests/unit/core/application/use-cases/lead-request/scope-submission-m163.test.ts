import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/domain/errors/domain-error";
import type { LeadRequestCategoryRecord, LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import { leadRequestCategoryPolicyFrom } from "@/domain/services/lead-request-category-support";
import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";
import { leadRequestSchema, MAX_SCOPE_ANSWERS } from "@/application/dto/lead-request.dto";
import { CreateLeadV1ServiceRequestUseCase } from "@/application/use-cases/lead/create-lead-v1-service-request.use-case";
import { ListLeadRequestCategoriesUseCase } from "@/application/use-cases/lead-request/list-lead-request-categories.use-case";
import { LeadRequestScopeInvalidError, SubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/submit-lead-request.use-case";
import { TEST_SCOPE_REGISTRY } from "../../../../../test-utils/scope-questionnaire-fixtures";

/** Module 163 — scope answers through the existing submission flow (no new flow): validation, fail-closed rejection, legacy isolation. */
const CAT = {
  plumbing: { id: "123e4567-e89b-42d3-a456-426614174001", name: "Fontanería", slug: "fontaneria", parentSlug: null },
  plumber: { id: "123e4567-e89b-42d3-a456-426614174002", name: "Fontanero", slug: "fontanero", parentSlug: "fontaneria" },
  electric: { id: "123e4567-e89b-42d3-a456-426614174005", name: "Electricidad", slug: "electricidad", parentSlug: null },
} satisfies Record<string, LeadRequestCategoryRecord>;
const repo: LeadRequestCategoryRepository = { listActive: async () => Object.values(CAT), findActiveById: async (id) => Object.values(CAT).find((c) => c.id === id) ?? null };
const policy = leadRequestCategoryPolicyFrom(resolveLeadPricingProductionConfig("lead-pricing-pilot-v1"));
const base = { categoryId: CAT.plumbing.id, title: "Fuga en el baño", description: "El grifo del lavabo gotea desde hace dos días.", location: { line1: "Calle Mayor 1", city: "Madrid", postalCode: "28001" } };
const parse = (extra: Record<string, unknown> = {}) => leadRequestSchema.parse({ ...base, ...extra });

function build(registry = TEST_SCOPE_REGISTRY) {
  const create = vi.fn().mockResolvedValue({ serviceRequest: { id: "sr-1" }, lead: { id: "lead-1" } });
  const publish = vi.fn().mockResolvedValue({ id: "lead-1", status: "PUBLISHED" });
  return { create, publish, useCase: new SubmitLeadRequestUseCase(repo, policy, { execute: create }, { execute: publish }, undefined, registry) };
}

describe("leadRequestSchema.scopeAnswers", () => {
  it("is optional, and absent stays absent", () => {
    expect(parse()).not.toHaveProperty("scopeAnswers");
  });
  it("accepts flat string / integer answers", () => {
    expect(parse({ scopeAnswers: { size: "large", rooms: 3 } }).scopeAnswers).toEqual({ size: "large", rooms: 3 });
  });
  it.each([
    ["nested object", { size: { v: 1 } }],
    ["array value", { size: ["a"] }],
    ["float", { size: 1.5 }],
    ["boolean", { size: true }],
    ["null value", { size: null }],
    ["over-long value (free text)", { size: "x".repeat(41) }],
    ["over-long key", { ["k".repeat(41)]: "a" }],
    ["array container", ["large"]],
  ])("rejects %s", (_l, scopeAnswers) => {
    expect(leadRequestSchema.safeParse({ ...base, scopeAnswers }).success).toBe(false);
  });
  it("rejects more than the maximum number of answers", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_SCOPE_ANSWERS + 1 }, (_, i) => [`q${i}`, "a"]));
    expect(leadRequestSchema.safeParse({ ...base, scopeAnswers: many }).success).toBe(false);
  });
  it("cannot smuggle budget through the schema (unknown top-level keys are stripped)", () => {
    expect(parse({ budgetMax: 5000 })).not.toHaveProperty("budgetMax");
  });
});

describe("SubmitLeadRequestUseCase — scope answers", () => {
  it("valid answers: validated server-side, stored as provenance, then published through the normal path", async () => {
    const { create, publish, useCase } = build();
    const input = parse({ scopeAnswers: { size: "large" } });
    await useCase.execute("u", input);
    expect(create).toHaveBeenCalledWith("u", input, { scope: { questionnaireVersion: "test-scope-v1", answers: { size: "large" } } });
    expect(publish).toHaveBeenCalledWith("u", "lead-1");
  });

  it("a subcategory resolves its parent's questionnaire", async () => {
    const { create, useCase } = build();
    await useCase.execute("u", parse({ categoryId: CAT.plumber.id, scopeAnswers: { size: "small" } }));
    expect(create.mock.calls[0]![2]).toEqual({ scope: { questionnaireVersion: "test-scope-v1", answers: { size: "small" } } });
  });

  it.each([
    ["unknown option", { size: "gigantic" }],
    ["unknown question (e.g. a budget)", { size: "large", budget: "5000" }],
    ["missing required answer", { other: "x" }],
    ["wrong type", { size: 3 }],
  ])("rejects %s with LeadRequestScopeInvalidError and creates nothing", async (_l, scopeAnswers) => {
    const { create, publish, useCase } = build();
    await expect(useCase.execute("u", parse({ scopeAnswers }))).rejects.toBeInstanceOf(LeadRequestScopeInvalidError);
    expect(create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("the error reports question ids and codes only — never the submitted values", async () => {
    const { useCase } = build();
    const err = await useCase.execute("u", parse({ scopeAnswers: { size: "SECRET-VALUE-123" } })).catch((e) => e);
    expect(err).toBeInstanceOf(LeadRequestScopeInvalidError);
    expect(JSON.stringify(err.issues)).not.toContain("SECRET-VALUE-123");
    expect(err.message).not.toContain("SECRET-VALUE-123");
  });

  it("answers for a category with no questionnaire are refused, not ignored (also the case for the shipped, empty registry)", async () => {
    for (const registry of [TEST_SCOPE_REGISTRY, {}]) {
      const { create, useCase } = build(registry);
      const input = parse({ categoryId: registry === TEST_SCOPE_REGISTRY ? CAT.electric.id : CAT.plumbing.id, scopeAnswers: { size: "large" } });
      await expect(useCase.execute("u", input)).rejects.toMatchObject({ code: "LEAD_REQUEST_SCOPE_INVALID", issues: [{ code: "QUESTIONNAIRE_NOT_AVAILABLE", questionId: null }] });
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("empty answers are not 'no scope': a required question is still missing", async () => {
    const { create, useCase } = build();
    await expect(useCase.execute("u", parse({ scopeAnswers: {} }))).rejects.toBeInstanceOf(LeadRequestScopeInvalidError);
    expect(create).not.toHaveBeenCalled();
  });

  it("no answers: exactly the pre-M163 two-argument call (legacy-shaped), even when a questionnaire exists", async () => {
    const { create, useCase } = build();
    const input = parse();
    await useCase.execute("u", input);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]).toEqual(["u", input]);
  });

  it("scope is checked before the category-independent privacy gates create anything", async () => {
    const { create, useCase } = build();
    await expect(useCase.execute("u", parse({ scopeAnswers: { size: "nope" } }), { acceptContactSharing: true } as never)).rejects.toBeInstanceOf(LeadRequestScopeInvalidError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("CreateLeadV1ServiceRequestUseCase — scope option", () => {
  function make() {
    const requests = { create: vi.fn(async (_c: string, _u: string, d: Record<string, unknown>) => ({ id: "sr-1", ...d })) };
    const customers = { findOrCreateByUserId: vi.fn(async () => ({ id: "cust-1" })) };
    const categories = { findActiveByIds: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))) };
    const geocoding = { geocode: vi.fn(async () => null) };
    const createLead = { execute: vi.fn(async () => ({ id: "lead-1" })) };
    const uc = new CreateLeadV1ServiceRequestUseCase(requests as never, customers as never, categories as never, geocoding as never, createLead as never);
    return { requests, createLead, uc };
  }
  const input = { categoryId: CAT.plumbing.id, title: "Fuga", description: "Fuga en el baño", location: { line1: "x", city: "Madrid", province: "Madrid", postalCode: "28001", country: "ES" } } as never;

  it("passes valid provenance to the repository together with flowVersion LEAD_V1", async () => {
    const { requests, uc } = make();
    await uc.execute("u", input, { scope: { questionnaireVersion: "test-scope-v1", answers: { size: "large" } } });
    expect(requests.create.mock.calls[0]![2]).toMatchObject({ flowVersion: "LEAD_V1", scope: { questionnaireVersion: "test-scope-v1", answers: { size: "large" } } });
  });

  it("without scope the repository data has no scope key", async () => {
    const { requests, uc } = make();
    await uc.execute("u", input);
    expect(requests.create.mock.calls[0]![2]).not.toHaveProperty("scope");
  });

  it.each([
    [{ questionnaireVersion: "v1", answers: {} }],
    [{ questionnaireVersion: "", answers: { a: "b" } }],
    [{ questionnaireVersion: "v1", answers: { a: { b: 1 } } }],
    [null],
  ])("malformed provenance %j is refused before anything is written", async (scope) => {
    const { requests, createLead, uc } = make();
    await expect(uc.execute("u", input, { scope: scope as never })).rejects.toBeInstanceOf(ValidationError);
    expect(requests.create).not.toHaveBeenCalled();
    expect(createLead.execute).not.toHaveBeenCalled();
  });
});

describe("ListLeadRequestCategoriesUseCase — scope view", () => {
  it("offers the questionnaire view (ids/kinds/values, no factors) for covered categories only", async () => {
    const list = await new ListLeadRequestCategoriesUseCase(repo, policy, TEST_SCOPE_REGISTRY).execute();
    const plumbing = list.find((c) => c.slug === "fontaneria")!;
    const plumber = list.find((c) => c.slug === "fontanero")!;
    expect(plumbing.scope).toMatchObject({ questionnaireVersion: "test-scope-v1", questions: [{ id: "size", kind: "SINGLE_CHOICE", required: true, options: ["small", "large"] }] });
    expect(plumber.scope).toBeDefined();
    expect(JSON.stringify(list)).not.toMatch(/scopeFactor|complexityFactor|maxScope|maxComplexity/);
  });

  it("with the default (empty) registry no category has a scope and the option shape is unchanged", async () => {
    const list = await new ListLeadRequestCategoriesUseCase(repo, policy).execute();
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) expect(Object.keys(c).sort()).toEqual(["id", "name", "slug"]);
  });
});
