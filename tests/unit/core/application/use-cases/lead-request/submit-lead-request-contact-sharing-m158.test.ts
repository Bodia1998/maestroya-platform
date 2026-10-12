import { describe, expect, it, vi } from "vitest";

import type { LeadRequestCategoryRecord, LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import { leadRequestCategoryPolicyFrom } from "@/domain/services/lead-request-category-support";
import { LeadContactSharingRequiredError, LeadPrivacyPolicyNotConfiguredError } from "@/domain/services/lead-privacy";
import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";
import { leadRequestSchema } from "@/application/dto/lead-request.dto";
import {
  SubmitLeadRequestUseCase,
  type LeadContactSharingCapture,
} from "@/application/use-cases/lead-request/submit-lead-request.use-case";

const CATEGORY: LeadRequestCategoryRecord = { id: "123e4567-e89b-42d3-a456-426614174001", name: "Fontanería", slug: "fontaneria", parentSlug: null };
const categories: LeadRequestCategoryRepository = {
  listActive: async () => [CATEGORY],
  findActiveById: async (id) => (id === CATEGORY.id ? CATEGORY : null),
};
const policy = leadRequestCategoryPolicyFrom(resolveLeadPricingProductionConfig("lead-pricing-pilot-v1"));
const input = leadRequestSchema.parse({
  categoryId: CATEGORY.id,
  title: "Fuga en el baño",
  description: "El grifo del lavabo gotea desde hace dos días.",
  location: { line1: "Calle Mayor 1", city: "Madrid", postalCode: "28001" },
});

function build(capturePolicy: LeadContactSharingCapture["policy"] | null, record?: ReturnType<typeof vi.fn>) {
  const create = vi.fn().mockResolvedValue({ serviceRequest: { id: "sr-1" }, lead: { id: "lead-1" } });
  const publish = vi.fn().mockResolvedValue({ id: "lead-1" });
  const recordFn = record ?? vi.fn().mockResolvedValue({});
  const cancelRequest = vi.fn().mockResolvedValue(undefined);
  const capture: LeadContactSharingCapture | undefined = capturePolicy
    ? { policy: capturePolicy, record: recordFn, cancelRequest }
    : undefined;
  return {
    create,
    publish,
    record: recordFn,
    cancelRequest,
    useCase: new SubmitLeadRequestUseCase(categories, policy, { execute: create }, { execute: publish }, capture),
  };
}

const CONSENT = { contactSharingBasis: "CONSENT", noticeVersion: "notice-v1" } as const;
const OTHER = { contactSharingBasis: "OTHER_LAWFUL_BASIS", noticeVersion: "notice-v1" } as const;
const UNDECIDED = { contactSharingBasis: null, noticeVersion: null } as const;

describe("M158 — SubmitLeadRequestUseCase contact-sharing capture", () => {
  it("policy CONSENT without an affirmative acceptance: refused BEFORE anything is created (silence is never consent)", async () => {
    for (const options of [undefined, {}, { contactSharingAccepted: false }]) {
      const t = build(CONSENT);
      await expect(t.useCase.execute("user", input, options)).rejects.toBeInstanceOf(LeadContactSharingRequiredError);
      expect(t.create).not.toHaveBeenCalled();
      expect(t.publish).not.toHaveBeenCalled();
      expect(t.record).not.toHaveBeenCalled();
    }
  });

  it("policy CONSENT + acceptance: evidence is recorded for the new lead BEFORE publication", async () => {
    const t = build(CONSENT);
    const order: string[] = [];
    t.record.mockImplementation(async () => void order.push("record"));
    t.publish.mockImplementation(async () => void order.push("publish"));
    const result = await t.useCase.execute("session-user", input, { contactSharingAccepted: true });
    expect(t.record).toHaveBeenCalledWith("session-user", "lead-1");
    expect(order).toEqual(["record", "publish"]);
    expect(result.publication).toBe("PUBLISHED");
    expect(JSON.stringify(result.receipt)).not.toMatch(/consent|notice|lead-1/i);
  });

  it("policy CONSENT + acceptance but the evidence cannot be stored: the request is taken off and the error surfaces; nothing is published", async () => {
    const t = build(CONSENT, vi.fn().mockRejectedValue(new Error("db down")));
    await expect(t.useCase.execute("user", input, { contactSharingAccepted: true })).rejects.toThrow("db down");
    expect(t.cancelRequest).toHaveBeenCalledWith("sr-1");
    expect(t.publish).not.toHaveBeenCalled();
  });

  it("policy names a basis but no notice version: an acceptance cannot be recorded, so nothing is created", async () => {
    const t = build({ contactSharingBasis: "CONSENT", noticeVersion: null });
    await expect(t.useCase.execute("user", input, { contactSharingAccepted: true })).rejects.toBeInstanceOf(LeadPrivacyPolicyNotConfiguredError);
    expect(t.create).not.toHaveBeenCalled();
  });

  it("another lawful basis: no consent is demanded, and notice evidence is recorded only when the customer affirmed it", async () => {
    const without = build(OTHER);
    await without.useCase.execute("user", input);
    expect(without.record).not.toHaveBeenCalled();
    expect(without.publish).toHaveBeenCalledOnce();

    const withNotice = build(OTHER);
    await withNotice.useCase.execute("user", input, { contactSharingAccepted: true });
    expect(withNotice.record).toHaveBeenCalledOnce();
  });

  it("another lawful basis: a failed notice record does not block publication (the notice is evidence, not the basis)", async () => {
    const t = build(OTHER, vi.fn().mockRejectedValue(new Error("x")));
    const result = await t.useCase.execute("user", input, { contactSharingAccepted: true });
    expect(result.publication).toBe("PUBLISHED");
    expect(t.cancelRequest).not.toHaveBeenCalled();
  });

  it("policy undecided (D19 open): unchanged behaviour, nothing recorded — even if a flag is passed, nobody is silently made a consenting customer", async () => {
    for (const options of [undefined, { contactSharingAccepted: true }]) {
      const t = build(UNDECIDED);
      const result = await t.useCase.execute("user", input, options);
      expect(result.publication).toBe("PUBLISHED");
      expect(t.record).not.toHaveBeenCalled();
    }
  });

  it("no capture wired at all: exactly the pre-M158 behaviour", async () => {
    const t = build(null);
    const result = await t.useCase.execute("user", input);
    expect(result.receipt).toEqual({ requestId: "sr-1", status: "RECEIVED" });
    expect(t.publish).toHaveBeenCalledOnce();
  });
});
