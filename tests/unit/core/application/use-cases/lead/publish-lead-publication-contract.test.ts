import { describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/domain/errors/domain-error";
import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import { InvalidLeadFlowError, LeadNotPublishableError, ServiceRequestNotEligibleForLeadError } from "@/domain/services/lead";
import { LeadPublicationRejectedError, type LeadPublicationPriceOutcome } from "@/domain/services/lead-publication";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";

import { PRICED_RESULT, TEST_BUYER_POLICY, fixedPriceSource, pricedOutcome, unpricedOutcome, withSnapshot } from "../../../../../test-utils/lead-publication-fixtures";

const USER = "user-1";
const CUSTOMER = "cust-1";
const now = new Date("2026-10-06T10:00:00Z");

const request = (patch: Partial<ServiceRequestRecord> = {}): ServiceRequestRecord =>
  ({
    id: "sr-1", customerId: CUSTOMER, categoryId: "cat", categoryName: "Fontanería", title: "Fuga", description: "Fuga en el baño", status: "PUBLISHED", urgency: "MEDIUM",
    budgetMin: null, budgetMax: null, location: { line1: "x", line2: null, city: "Madrid", province: "Madrid", postalCode: "28001", country: "ES", latitude: null, longitude: null },
    photos: [], createdAt: now, updatedAt: now, ...patch,
  }) as ServiceRequestRecord;

const draft = (patch: Partial<LeadRecord> = {}): LeadRecord => ({ id: "lead-1", serviceRequestId: "sr-1", status: "DRAFT", flowVersion: "LEAD_V1", maxBuyers: null, publication: null, createdAt: now, updatedAt: now, ...patch });

/** In-memory repository with a genuinely atomic compare-and-set publish (synchronous check+write, like the conditional UPDATE). */
function repoWith(initial: LeadRecord, opts: { failWrite?: boolean } = {}) {
  const rows = new Map([[initial.id, initial]]);
  const repo: LeadRepository & { rows: Map<string, LeadRecord> } = {
    rows,
    create: vi.fn(),
    publish: vi.fn(async (id, snapshot) => {
      await Promise.resolve(); // yield: concurrent callers interleave here
      if (opts.failWrite) throw new Error("db down");
      const row = rows.get(id);
      if (!row || row.status !== "DRAFT" || row.publication) return null;
      const next = withSnapshot(row, snapshot);
      rows.set(id, next);
      return next;
    }),
    findById: vi.fn(async (id) => rows.get(id) ?? null),
    findByServiceRequestId: vi.fn(),
  } as never;
  return repo;
}

function build(opts: { lead?: LeadRecord; req?: ServiceRequestRecord | null; outcome?: LeadPublicationPriceOutcome | (() => LeadPublicationPriceOutcome); policy?: unknown; failWrite?: boolean } = {}) {
  const leads = repoWith(opts.lead ?? draft(), { failWrite: opts.failWrite });
  const source = fixedPriceSource("outcome" in opts ? opts.outcome! : pricedOutcome());
  const uc = new PublishLeadUseCase(
    { findByUserId: vi.fn(async () => ({ id: CUSTOMER })) } as never,
    { findById: vi.fn(async () => (opts.req === undefined ? request() : opts.req)) } as never,
    leads,
    source,
    ("policy" in opts ? opts.policy : TEST_BUYER_POLICY) as never,
  );
  return { uc, leads, source };
}

describe("PublishLeadUseCase — publication contract", () => {
  describe("successful publication", () => {
    it("publishes a valid LEAD_V1 lead with its snapshot and buyer policy", async () => {
      const { uc, leads } = build();
      const result = await uc.execute(USER, "lead-1");
      expect(result.status).toBe("PUBLISHED");
      expect(result.maxBuyers).toBe(2);
      expect(result.publication).toMatchObject({
        price: "18.00", currency: "EUR", estimatedJobValue: "150.00", pricingRate: "0.12",
        pricingConfigVersion: "lead-pricing-test-config-v1", jobValueRuleVersion: "job-value-test-v1", pricingRuleVersion: "lead-pricing-test-v1",
        buyerPolicyVersion: "lead-buyer-policy-test-v1", maxBuyers: 2,
      });
      expect(leads.publish).toHaveBeenCalledTimes(1);
    });

    it("status and snapshot arrive in ONE repository call (no separate status write)", async () => {
      const { uc, leads } = build();
      await uc.execute(USER, "lead-1");
      expect(leads.publish).toHaveBeenCalledWith("lead-1", expect.objectContaining({ price: "18.00", maxBuyers: 2 }));
      expect(Object.keys(leads).sort()).toEqual(["create", "findById", "findByServiceRequestId", "publish", "rows"]);
    });
  });

  describe("priceability gate rejects, and the lead stays DRAFT and retryable", () => {
    const cases: Array<[string, LeadPublicationPriceOutcome, string]> = [
      ["UNPRICED", unpricedOutcome("UNPRICED", "SERVICE_VALUE_UNAVAILABLE"), "UNPRICED"],
      ["CATEGORY_UNSUPPORTED", unpricedOutcome("UNPRICED", "CATEGORY_UNSUPPORTED"), "CATEGORY_UNSUPPORTED"],
      ["CONFIDENCE_TOO_LOW", unpricedOutcome("UNPRICED", "CONFIDENCE_TOO_LOW"), "CONFIDENCE_TOO_LOW"],
      ["INVALID_INPUT", unpricedOutcome("INVALID_INPUT", "INVALID_SERVICE_VALUE"), "PRICING_INPUT_INVALID"],
      ["missing/invalid configuration", { kind: "CONFIGURATION_UNAVAILABLE" }, "PRICING_CONFIGURATION_UNAVAILABLE"],
      ["malformed result", { kind: "RESOLVED", configVersion: "c", jobValueRuleVersion: "j", result: { status: "PRICED", price: "0.00" } } as never, "PRICING_RESULT_MALFORMED"],
      ["unknown shape", undefined as never, "PRICING_RESULT_MALFORMED"],
    ];
    it.each(cases)("%s", async (_n, outcome, expected) => {
      const { uc, leads } = build({ outcome });
      await expect(uc.execute(USER, "lead-1")).rejects.toMatchObject({ code: "LEAD_PUBLICATION_REJECTED", reason: expected });
      expect(leads.publish).not.toHaveBeenCalled();
      expect(leads.rows.get("lead-1")).toMatchObject({ status: "DRAFT", maxBuyers: null, publication: null });
    });

    it("recovers once pricing succeeds (retryable) and never writes a placeholder price", async () => {
      let priceable = false;
      const { uc, leads } = build({ outcome: () => (priceable ? pricedOutcome() : unpricedOutcome("UNPRICED", "CATEGORY_UNSUPPORTED")) });
      await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(LeadPublicationRejectedError);
      priceable = true;
      expect((await uc.execute(USER, "lead-1")).publication?.price).toBe("18.00");
      expect(leads.publish).toHaveBeenCalledTimes(1);
    });

    it("consults the price source exactly once per attempt (no retry with another configuration)", async () => {
      const { uc, source } = build({ outcome: { kind: "CONFIGURATION_UNAVAILABLE" } });
      await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(LeadPublicationRejectedError);
      expect(source.calls).toBe(1);
    });
  });

  describe("flow, request and lifecycle guards", () => {
    it("legacy flow cannot publish through the LEAD_V1 contract (price never even requested)", async () => {
      const { uc, leads, source } = build({ lead: draft({ flowVersion: "LEGACY_QUOTE_PAYMENT" }) });
      await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(InvalidLeadFlowError);
      expect(source.calls).toBe(0);
      expect(leads.publish).not.toHaveBeenCalled();
    });

    it("missing flow version fails closed", async () => {
      for (const flowVersion of [undefined, null, ""]) {
        const { uc, leads } = build({ lead: draft({ flowVersion: flowVersion as never }) });
        await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(InvalidLeadFlowError);
        expect(leads.publish).not.toHaveBeenCalled();
      }
    });

    it("a deleted/missing request cannot publish (repository hides soft-deleted requests)", async () => {
      const { uc, leads } = build({ req: null });
      await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(NotFoundError);
      expect(leads.publish).not.toHaveBeenCalled();
    });

    it("a request that is not open or is incomplete cannot publish", async () => {
      for (const req of [request({ status: "CANCELLED" }), request({ status: "EXPIRED" }), request({ description: " " })]) {
        const { uc, leads, source } = build({ req });
        await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(ServiceRequestNotEligibleForLeadError);
        expect(source.calls).toBe(0);
        expect(leads.publish).not.toHaveBeenCalled();
      }
    });

    it.each(["CLOSED", "EXPIRED", "CANCELLED"] as const)("terminal %s lead is never published (no resurrection)", async (status) => {
      const { uc, leads, source } = build({ lead: draft({ status }) });
      await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(LeadNotPublishableError);
      expect(source.calls).toBe(0);
      expect(leads.rows.get("lead-1")).toMatchObject({ status, publication: null });
    });

    it("a lead that turns terminal between read and write is rejected, not resurrected", async () => {
      const { uc, leads } = build();
      (leads.findById as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => leads.rows.get("lead-1")!);
      (leads.publish as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        leads.rows.set("lead-1", draft({ status: "CANCELLED" }));
        return null;
      });
      await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(LeadNotPublishableError);
      expect(leads.rows.get("lead-1")!.status).toBe("CANCELLED");
    });
  });

  describe("buyer policy", () => {
    it.each([
      [{ policyVersion: "p1", maxBuyers: 0 }],
      [{ policyVersion: "p1", maxBuyers: null }],
      [{ policyVersion: "p1", maxBuyers: 2.5 }],
      [{ policyVersion: "", maxBuyers: 1 }],
      [undefined],
    ])("an invalid policy %j prevents publication", async (policy) => {
      const { uc, leads, source } = build({ policy });
      await expect(uc.execute(USER, "lead-1")).rejects.toMatchObject({ reason: "BUYER_POLICY_INVALID" });
      expect(source.calls).toBe(0);
      expect(leads.publish).not.toHaveBeenCalled();
    });

    it("the policy (version + maxBuyers) is snapshotted", async () => {
      const { uc } = build({ policy: { policyVersion: "p-shared-v1", maxBuyers: 3 } });
      const result = await uc.execute(USER, "lead-1");
      expect(result.publication).toMatchObject({ buyerPolicyVersion: "p-shared-v1", maxBuyers: 3 });
      expect(result.maxBuyers).toBe(3);
    });

    it("repeated publication under a different policy cannot change the published policy", async () => {
      const first = build({ policy: { policyVersion: "p1", maxBuyers: 1 } });
      const published = await first.uc.execute(USER, "lead-1");
      const again = new PublishLeadUseCase(
        { findByUserId: async () => ({ id: CUSTOMER }) } as never, { findById: async () => request() } as never, first.leads,
        fixedPriceSource(pricedOutcome()), { policyVersion: "p2", maxBuyers: 9 },
      );
      const repeated = await again.execute(USER, "lead-1");
      expect(repeated.publication).toEqual(published.publication);
      expect(repeated.maxBuyers).toBe(1);
    });
  });

  describe("idempotency and immutability", () => {
    it("repeating publication returns the same snapshot and does not write or even price again", async () => {
      const { uc, leads, source } = build();
      const a = await uc.execute(USER, "lead-1");
      const b = await uc.execute(USER, "lead-1");
      expect(b).toEqual(a);
      expect(leads.publish).toHaveBeenCalledTimes(1);
      expect(source.calls).toBe(1);
    });

    it("a repeat after the price source changed cannot overwrite the snapshot", async () => {
      let outcome = pricedOutcome();
      const { uc } = build({ outcome: () => outcome });
      const first = await uc.execute(USER, "lead-1");
      outcome = pricedOutcome({ configVersion: "lead-pricing-test-config-v2", result: { ...PRICED_RESULT, price: "99.00", ruleVersion: "lead-pricing-test-v2" } as never });
      const second = await uc.execute(USER, "lead-1");
      expect(second.publication).toEqual(first.publication);
      expect(second.publication?.price).toBe("18.00");
      expect(second.publication?.pricingConfigVersion).toBe("lead-pricing-test-config-v1");
    });

    it("an already published lead is returned unchanged (even without a snapshot: legacy lead is not back-filled)", async () => {
      const legacy = draft({ status: "PUBLISHED", maxBuyers: null, publication: null });
      const { uc, leads, source } = build({ lead: legacy });
      expect(await uc.execute(USER, "lead-1")).toEqual(legacy);
      expect(source.calls).toBe(0);
      expect(leads.publish).not.toHaveBeenCalled();
    });
  });

  describe("failed publication leaves no published lead", () => {
    it("a failing write leaves the lead DRAFT with no snapshot", async () => {
      const { uc, leads } = build({ failWrite: true });
      await expect(uc.execute(USER, "lead-1")).rejects.toThrow("db down");
      expect(leads.rows.get("lead-1")).toMatchObject({ status: "DRAFT", maxBuyers: null, publication: null });
    });

    it("a failing price source leaves the lead DRAFT", async () => {
      const { uc, leads } = build({ outcome: () => { throw new Error("estimation reader down"); } });
      await expect(uc.execute(USER, "lead-1")).rejects.toThrow("estimation reader down");
      expect(leads.publish).not.toHaveBeenCalled();
      expect(leads.rows.get("lead-1")).toMatchObject({ status: "DRAFT", publication: null });
    });
  });

  describe("concurrency", () => {
    it("competing publications: the first snapshot wins, nobody gets a conflicting one", async () => {
      const prices = ["10.00", "20.00", "30.00", "40.00", "50.00"];
      let i = 0;
      const { uc, leads } = build({
        outcome: () => pricedOutcome({ result: { ...PRICED_RESULT, price: prices[i++ % prices.length]! } as never }),
      });
      const results = await Promise.all(prices.map(() => uc.execute(USER, "lead-1")));
      const stored = leads.rows.get("lead-1")!;
      expect(stored.status).toBe("PUBLISHED");
      expect(leads.publish).toHaveBeenCalledTimes(prices.length);
      expect((leads.publish as ReturnType<typeof vi.fn>).mock.results.length).toBe(prices.length);
      // exactly one write won; every caller observes the winner's snapshot
      expect(new Set(results.map((r) => JSON.stringify(r.publication))).size).toBe(1);
      expect(results[0]!.publication).toEqual(stored.publication);
      expect(prices).toContain(stored.publication!.price);
    });

    it("publish racing a cancellation never produces a published terminal lead", async () => {
      const { uc, leads } = build();
      const cancel = (async () => {
        await Promise.resolve();
        const row = leads.rows.get("lead-1")!;
        if (row.status === "DRAFT") leads.rows.set("lead-1", { ...row, status: "CANCELLED" });
      })();
      const settled = await Promise.allSettled([uc.execute(USER, "lead-1"), cancel]);
      const final = leads.rows.get("lead-1")!;
      if (final.status === "CANCELLED") {
        expect(final.publication).toBeNull();
        expect(settled[0]!.status).toBe("rejected");
      } else {
        expect(final.status).toBe("PUBLISHED");
        expect(final.publication).not.toBeNull();
      }
    });
  });
});
