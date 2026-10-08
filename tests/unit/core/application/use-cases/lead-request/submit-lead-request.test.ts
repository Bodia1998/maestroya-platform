import { describe, expect, it, vi } from "vitest";

import type { LeadRequestCategoryRecord, LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import { leadRequestCategoryPolicyFrom } from "@/domain/services/lead-request-category-support";
import { LeadPublicationRejectedError } from "@/domain/services/lead-publication";
import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";
import { leadRequestSchema } from "@/application/dto/lead-request.dto";
import { ListLeadRequestCategoriesUseCase } from "@/application/use-cases/lead-request/list-lead-request-categories.use-case";
import {
  LeadRequestCategoryUnsupportedError,
  SubmitLeadRequestUseCase,
} from "@/application/use-cases/lead-request/submit-lead-request.use-case";

const CAT = {
  plumbing: { id: "123e4567-e89b-42d3-a456-426614174001", name: "Fontanería", slug: "fontaneria", parentSlug: null },
  plumber: { id: "123e4567-e89b-42d3-a456-426614174002", name: "Fontanero", slug: "fontanero", parentSlug: "fontaneria" },
  works: { id: "123e4567-e89b-42d3-a456-426614174003", name: "Reformas", slug: "reformas", parentSlug: null },
  garden: { id: "123e4567-e89b-42d3-a456-426614174004", name: "Jardinería", slug: "jardineria", parentSlug: null },
} satisfies Record<string, LeadRequestCategoryRecord>;

const repo: LeadRequestCategoryRepository = {
  listActive: async () => Object.values(CAT),
  findActiveById: async (id) => Object.values(CAT).find((c) => c.id === id) ?? null,
};
const policy = leadRequestCategoryPolicyFrom(resolveLeadPricingProductionConfig("lead-pricing-pilot-v1"));

const input = leadRequestSchema.parse({
  categoryId: CAT.plumbing.id,
  title: "Fuga en el baño",
  description: "El grifo del lavabo gotea desde hace dos días.",
  location: { line1: "Calle Mayor 1", city: "Madrid", postalCode: "28001" },
});

function build(overrides: { create?: ReturnType<typeof vi.fn>; publish?: ReturnType<typeof vi.fn> } = {}) {
  const create =
    overrides.create ??
    vi.fn().mockResolvedValue({
      serviceRequest: { id: "sr-1", customerId: "internal-customer", flowVersion: "LEAD_V1" },
      lead: { id: "lead-1", status: "DRAFT", pricingSnapshot: { amount: "12.00" }, buyerPolicyVersion: "v1" },
    });
  const publish = overrides.publish ?? vi.fn().mockResolvedValue({ id: "lead-1", status: "PUBLISHED" });
  return { create, publish, useCase: new SubmitLeadRequestUseCase(repo, policy, { execute: create }, { execute: publish }) };
}

describe("SubmitLeadRequestUseCase", () => {
  it("creates the request for the session user, publishes it, and returns only a safe receipt", async () => {
    const { create, publish, useCase } = build();
    const result = await useCase.execute("session-user", input);
    expect(create).toHaveBeenCalledWith("session-user", input);
    expect(publish).toHaveBeenCalledWith("session-user", "lead-1");
    expect(result.receipt).toEqual({ requestId: "sr-1", status: "RECEIVED" });
    expect(result.publication).toBe("PUBLISHED");
    expect(JSON.stringify(result.receipt)).not.toMatch(/lead-1|internal-customer|LEAD_V1|snapshot|amount|buyerPolicy/i);
  });

  it("accepts a subcategory of a supported category", async () => {
    const { create, useCase } = build();
    await useCase.execute("u", { ...input, categoryId: CAT.plumber.id });
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([["unsupported (reformas)", CAT.works.id], ["unknown to the pilot", CAT.garden.id], ["nonexistent", "123e4567-e89b-42d3-a456-426614174999"]])(
    "rejects a category that is %s before creating anything",
    async (_label, categoryId) => {
      const { create, publish, useCase } = build();
      await expect(useCase.execute("u", { ...input, categoryId })).rejects.toBeInstanceOf(LeadRequestCategoryUnsupportedError);
      expect(create).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("rejects every category when the pricing configuration is not valid (fail closed)", async () => {
    const closed = leadRequestCategoryPolicyFrom(resolveLeadPricingProductionConfig(undefined));
    const create = vi.fn();
    const useCase = new SubmitLeadRequestUseCase(repo, closed, { execute: create }, { execute: vi.fn() });
    await expect(useCase.execute("u", input)).rejects.toBeInstanceOf(LeadRequestCategoryUnsupportedError);
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates a creation failure and never attempts publication", async () => {
    const { publish, useCase } = build({ create: vi.fn().mockRejectedValue(new Error("db down")) });
    await expect(useCase.execute("u", input)).rejects.toThrow("db down");
    expect(publish).not.toHaveBeenCalled();
  });

  it("still succeeds for the customer when publication is rejected (no duplicate-inducing failure)", async () => {
    const { useCase } = build({ publish: vi.fn().mockRejectedValue(new LeadPublicationRejectedError("CATEGORY_UNSUPPORTED" as never)) });
    const result = await useCase.execute("u", input);
    expect(result.receipt).toEqual({ requestId: "sr-1", status: "RECEIVED" });
    expect(result.publication).toBe("DEFERRED");
  });

  it("also contains unexpected publication errors once the request exists", async () => {
    const { useCase } = build({ publish: vi.fn().mockRejectedValue(new Error("boom")) });
    expect((await useCase.execute("u", input)).publication).toBe("DEFERRED");
  });
});

describe("ListLeadRequestCategoriesUseCase", () => {
  it("offers only supported categories, as id/slug/name and nothing else", async () => {
    const list = await new ListLeadRequestCategoriesUseCase(repo, policy).execute();
    expect(list.map((c) => c.slug).sort()).toEqual(["fontaneria", "fontanero"]);
    expect(list.map((c) => c.slug)).not.toContain("reformas");
    expect(list.map((c) => c.slug)).not.toContain("jardineria");
    for (const option of list) expect(Object.keys(option).sort()).toEqual(["id", "name", "slug"]);
  });

  it("offers nothing when the configuration is not valid", async () => {
    const closed = leadRequestCategoryPolicyFrom(resolveLeadPricingProductionConfig("nope"));
    expect(await new ListLeadRequestCategoriesUseCase(repo, closed).execute()).toEqual([]);
  });
});
