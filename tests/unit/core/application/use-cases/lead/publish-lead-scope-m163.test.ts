import { describe, expect, it, vi } from "vitest";

import { LeadPublicationRejectedError } from "@/domain/services/lead-publication";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";
import { TEST_BUYER_POLICY, fixedPriceSource, pricedOutcome, withSnapshot } from "../../../../../test-utils/lead-publication-fixtures";

/** Module 163 — publication guards with scope provenance: persisted in the one atomic write, malformed provenance blocks publication. */
const now = new Date("2026-10-06T10:00:00Z");
const request = {
  id: "sr-1", customerId: "cust-1", categoryId: "cat", categoryName: "Fontanería", title: "Fuga", description: "Fuga en el baño", status: "PUBLISHED", urgency: "MEDIUM",
  budgetMin: null, budgetMax: null, location: { line1: "x", line2: null, city: "Madrid", province: "Madrid", postalCode: "28001", country: "ES", latitude: null, longitude: null },
  photos: [], createdAt: now, updatedAt: now,
};
const draft = { id: "lead-1", serviceRequestId: "sr-1", status: "DRAFT", flowVersion: "LEAD_V1", maxBuyers: null, publication: null, createdAt: now, updatedAt: now };

function build(outcome: unknown) {
  const publish = vi.fn(async (_id: string, snapshot: never) => withSnapshot(draft as never, snapshot));
  const leads = { findById: vi.fn(async () => draft), publish } as never;
  const uc = new PublishLeadUseCase({ findByUserId: vi.fn(async () => ({ id: "cust-1" })) } as never, { findById: vi.fn(async () => request) } as never, leads, fixedPriceSource(outcome as never), TEST_BUYER_POLICY);
  return { uc, publish };
}

describe("PublishLeadUseCase — scope provenance", () => {
  it("writes the provenance in the same single publish call as the price snapshot", async () => {
    const { uc, publish } = build(pricedOutcome({ scope: { questionnaireVersion: "test-scope-v1", answers: { size: "large" } } }));
    await uc.execute("user-1", "lead-1");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![1]).toMatchObject({ price: "18.00", scopeQuestionnaireVersion: "test-scope-v1", scopeAnswers: { size: "large" } });
  });

  it("without scope the snapshot has no scope keys", async () => {
    const { uc, publish } = build(pricedOutcome());
    await uc.execute("user-1", "lead-1");
    expect(publish.mock.calls[0]![1]).not.toHaveProperty("scopeAnswers");
  });

  it("malformed provenance blocks publication: nothing is written", async () => {
    const { uc, publish } = build(pricedOutcome({ scope: { questionnaireVersion: "v1", answers: {} } as never }));
    await expect(uc.execute("user-1", "lead-1")).rejects.toBeInstanceOf(LeadPublicationRejectedError);
    expect(publish).not.toHaveBeenCalled();
  });
});
