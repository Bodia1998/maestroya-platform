import { describe, expect, it, vi } from "vitest";

import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { LeadPricingReviewRepository } from "@/domain/repositories/lead-pricing-review-repository";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import { LeadPublicationRejectedError, type LeadPublicationPriceOutcome } from "@/domain/services/lead-publication";
import {
  LeadPricingReviewRejectedError,
  LeadPricingUnderReviewError,
  type LeadPricingReviewRecord,
  type OpenLeadPricingReviewInput,
} from "@/domain/services/lead-pricing-review";
import { validateRegionalCalibrationConfig, type RegionalCalibrationConfig } from "@/domain/services/lead-regional-calibration";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";
import { CalibratedLeadPublicationPriceSource } from "@/application/services/lead-pricing/calibrated-lead-publication-price-source";
import { RegionalPricingModePriceSource } from "@/application/services/lead-pricing/regional-pricing-mode-price-source";
import {
  DecideLeadPricingReviewUseCase,
  GetLeadPricingReviewUseCase,
  ListLeadPricingReviewsUseCase,
} from "@/application/use-cases/lead-pricing-review/lead-pricing-review.use-cases";
import { LEAD_REGIONAL_CALIBRATION_V1 } from "@/infrastructure/pricing/lead-regional-calibration.v1";

import { TEST_BUYER_POLICY, fixedPriceSource, pricedOutcome, withSnapshot } from "../../../../../test-utils/lead-publication-fixtures";

const now = new Date("2026-10-14T10:00:00Z");
const ADMIN = "admin-1";

const resolved = (c: RegionalCalibrationConfig = LEAD_REGIONAL_CALIBRATION_V1) => {
  const r = validateRegionalCalibrationConfig(c);
  if (r.status !== "VALID") throw new Error("test config invalid");
  return r;
};

const context = (over: Record<string, unknown> = {}) => ({ flowVersion: LEAD_FLOW_VERSION, categorySlug: "fontaneria", parentCategorySlug: null, urgency: null, ...over });
const contexts = (ctx: unknown = context()) => ({ findByLeadId: vi.fn(async () => ctx) }) as never;
const regions = (region: unknown = { status: "RESOLVED", provinceCode: "28" }) => ({ findByLeadId: vi.fn(async () => region) }) as never;

/** In-memory review repository with the same keys/guards as the table (unique (lead, fingerprint); conditional decide). */
function reviewRepo() {
  const rows = new Map<string, LeadPricingReviewRecord>();
  let seq = 0;
  const repo = {
    rows,
    openOrGet: vi.fn(async (input: OpenLeadPricingReviewInput) => {
      const existing = [...rows.values()].find((r) => r.leadId === input.leadId && r.inputFingerprint === input.inputFingerprint);
      if (existing) return { review: existing, created: false };
      for (const r of rows.values()) if (r.leadId === input.leadId && r.status === "PENDING_REVIEW") rows.set(r.id, { ...r, status: "SUPERSEDED" });
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
      const review: LeadPricingReviewRecord = {
        id, leadId: input.leadId, inputFingerprint: input.inputFingerprint, status: "PENDING_REVIEW", reasonCodes: input.reasonCodes,
        categorySlug: input.categorySlug, parentCategorySlug: input.parentCategorySlug, provinceCode: input.provinceCode,
        calibrationVersion: input.calibrationVersion, provenance: input.provenance, createdAt: now, decidedAt: null, decidedByUserId: null,
        reviewedJobValue: null, decisionNote: null,
      };
      rows.set(id, review);
      return { review, created: true };
    }),
    findByLeadAndFingerprint: vi.fn(async (leadId: string, fp: string) => [...rows.values()].find((r) => r.leadId === leadId && r.inputFingerprint === fp) ?? null),
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    list: vi.fn(async (f: { status: string | null; limit: number; offset: number }) => [...rows.values()].filter((r) => f.status === null || r.status === f.status).slice(f.offset, f.offset + f.limit)),
    decide: vi.fn(async (id: string, d: { outcome: "APPROVED" | "REJECTED"; reviewedJobValue?: string; note: string | null }, actor: string, at: Date) => {
      const row = rows.get(id);
      if (!row || row.status !== "PENDING_REVIEW") return null;
      const next: LeadPricingReviewRecord = { ...row, status: d.outcome, decidedAt: at, decidedByUserId: actor, reviewedJobValue: d.outcome === "APPROVED" ? (d.reviewedJobValue ?? null) : null, decisionNote: d.note };
      rows.set(id, next);
      return next;
    }),
  };
  return repo as typeof repo & LeadPricingReviewRepository;
}

describe("M164 — calibrated price source (reads only; never writes)", () => {
  it("releases nothing without a valid calibration (fail closed)", async () => {
    const src = new CalibratedLeadPublicationPriceSource(contexts(), regions(), { status: "INCOMPLETE", issues: [] }, reviewRepo());
    expect(await src.priceForLead("lead-1")).toEqual({ kind: "CONFIGURATION_UNAVAILABLE" });
  });

  it("an unknown lead is unpriced", async () => {
    const src = new CalibratedLeadPublicationPriceSource(contexts(null), regions(), resolved(), reviewRepo());
    const out = await src.priceForLead("nope");
    expect(out.kind).toBe("RESOLVED");
    if (out.kind === "RESOLVED") expect(out.result).toMatchObject({ status: "UNPRICED", reason: "LEAD_NOT_FOUND" });
  });

  it("shipped release → REVIEW_REQUIRED with a stable fingerprint and complete provenance, and nothing is written", async () => {
    const reviews = reviewRepo();
    const src = new CalibratedLeadPublicationPriceSource(contexts(), regions(), resolved(), reviews);
    const a = await src.priceForLead("lead-1");
    const b = await src.priceForLead("lead-1");
    expect(a.kind).toBe("REVIEW_REQUIRED");
    if (a.kind !== "REVIEW_REQUIRED" || b.kind !== "REVIEW_REQUIRED") throw new Error("expected review");
    expect(a.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(b.inputFingerprint).toBe(a.inputFingerprint);
    expect(a.provinceCode).toBe("28");
    expect(a.reasons).toContain("CALIBRATION_MISSING");
    expect(reviews.openOrGet).not.toHaveBeenCalled();
    expect(reviews.rows.size).toBe(0);
  });

  it.each([
    ["Canary Islands", "35"],
    ["Ceuta", "51"],
    ["Melilla", "52"],
  ])("%s → unpriceable, never reviewed", async (_n, province) => {
    const src = new CalibratedLeadPublicationPriceSource(contexts(), regions({ status: "RESOLVED", provinceCode: province }), resolved(), reviewRepo());
    expect(await src.priceForLead("lead-1")).toMatchObject({ kind: "UNPRICEABLE", reason: "TERRITORY_UNSUPPORTED" });
  });

  it("unresolvable address → unpriceable", async () => {
    const src = new CalibratedLeadPublicationPriceSource(contexts(), regions({ status: "UNKNOWN", reason: "POSTAL_CODE_INVALID" }), resolved(), reviewRepo());
    expect(await src.priceForLead("lead-1")).toMatchObject({ kind: "UNPRICEABLE", reason: "REGION_UNRESOLVED" });
  });

  it("an approved review for the SAME inputs is priced at 10% of the reviewed value, labelled as an administrator assessment", async () => {
    const reviews = reviewRepo();
    const src = new CalibratedLeadPublicationPriceSource(contexts(), regions(), resolved(), reviews);
    const first = await src.priceForLead("lead-1");
    if (first.kind !== "REVIEW_REQUIRED") throw new Error("expected review");
    const { review } = await reviews.openOrGet({ leadId: "lead-1", inputFingerprint: first.inputFingerprint, reasonCodes: first.reasons, categorySlug: "fontaneria", parentCategorySlug: null, provinceCode: "28", calibrationVersion: first.configVersion, provenance: first.provenance });
    await reviews.decide(review.id, { outcome: "APPROVED", reviewedJobValue: "800.00", note: null }, ADMIN, now);

    const out = await src.priceForLead("lead-1");
    expect(out.kind).toBe("RESOLVED");
    if (out.kind === "RESOLVED") {
      expect(out.result).toMatchObject({ status: "PRICED", price: "80.00" });
      expect(out.calibration).toMatchObject({ source: "ADMIN_REVIEW", averageJobValue: "800.00", price: "80.00" });
    }
  });

  it("a rejected review is unpriceable and the lead cannot be published", async () => {
    const reviews = reviewRepo();
    const src = new CalibratedLeadPublicationPriceSource(contexts(), regions(), resolved(), reviews);
    const first = await src.priceForLead("lead-1");
    if (first.kind !== "REVIEW_REQUIRED") throw new Error("expected review");
    const { review } = await reviews.openOrGet({ leadId: "lead-1", inputFingerprint: first.inputFingerprint, reasonCodes: first.reasons, categorySlug: "fontaneria", parentCategorySlug: null, provinceCode: "28", calibrationVersion: first.configVersion, provenance: first.provenance });
    await reviews.decide(review.id, { outcome: "REJECTED", note: "n/a" }, ADMIN, now);
    expect(await src.priceForLead("lead-1")).toMatchObject({ kind: "UNPRICEABLE", reason: "REVIEW_REJECTED" });
  });

  it("an approval does not carry over to different inputs (other province → new fingerprint → review again)", async () => {
    const reviews = reviewRepo();
    const at28 = new CalibratedLeadPublicationPriceSource(contexts(), regions(), resolved(), reviews);
    const first = await at28.priceForLead("lead-1");
    if (first.kind !== "REVIEW_REQUIRED") throw new Error("expected review");
    const { review } = await reviews.openOrGet({ leadId: "lead-1", inputFingerprint: first.inputFingerprint, reasonCodes: first.reasons, categorySlug: "fontaneria", parentCategorySlug: null, provinceCode: "28", calibrationVersion: first.configVersion, provenance: first.provenance });
    await reviews.decide(review.id, { outcome: "APPROVED", reviewedJobValue: "800.00", note: null }, ADMIN, now);

    const moved = new CalibratedLeadPublicationPriceSource(contexts(), regions({ status: "RESOLVED", provinceCode: "08" }), resolved(), reviews);
    expect((await moved.priceForLead("lead-1")).kind).toBe("REVIEW_REQUIRED");
  });

  it("an approval made under another calibration version does not apply (stale)", async () => {
    const reviews = reviewRepo();
    const v1 = new CalibratedLeadPublicationPriceSource(contexts(), regions(), resolved(), reviews);
    const first = await v1.priceForLead("lead-1");
    if (first.kind !== "REVIEW_REQUIRED") throw new Error("expected review");
    const { review } = await reviews.openOrGet({ leadId: "lead-1", inputFingerprint: first.inputFingerprint, reasonCodes: first.reasons, categorySlug: "fontaneria", parentCategorySlug: null, provinceCode: "28", calibrationVersion: first.configVersion, provenance: first.provenance });
    await reviews.decide(review.id, { outcome: "APPROVED", reviewedJobValue: "800.00", note: null }, ADMIN, now);
    const v2 = new CalibratedLeadPublicationPriceSource(contexts(), regions(), resolved({ ...LEAD_REGIONAL_CALIBRATION_V1, calibrationVersion: "lead-regional-pricing-v2" }), reviews);
    expect((await v2.priceForLead("lead-1")).kind).toBe("REVIEW_REQUIRED");
  });
});

describe("M164 — mode switch (OFF / SHADOW / ENFORCE)", () => {
  const legacy = () => fixedPriceSource(pricedOutcome());
  const calibrated = (kind: "review" | "throw" = "review") =>
    ({
      calls: 0,
      priceForLead: vi.fn(async () => {
        if (kind === "throw") throw new Error("boom");
        return { kind: "CONFIGURATION_UNAVAILABLE" } as LeadPublicationPriceOutcome;
      }),
    }) as never;

  it("OFF is the legacy outcome and never touches the calibrated pipeline", async () => {
    const cal = calibrated();
    const src = new RegionalPricingModePriceSource(legacy(), cal, () => "OFF");
    expect((await src.priceForLead("l")).kind).toBe("RESOLVED");
    expect((cal as { priceForLead: ReturnType<typeof vi.fn> }).priceForLead).not.toHaveBeenCalled();
  });

  it("ENFORCE returns only the calibrated outcome (no fallback to legacy)", async () => {
    const leg = legacy();
    const src = new RegionalPricingModePriceSource(leg, calibrated(), () => "ENFORCE");
    expect(await src.priceForLead("l")).toEqual({ kind: "CONFIGURATION_UNAVAILABLE" });
    expect(leg.calls).toBe(0);
  });

  it("SHADOW returns the legacy outcome, observes labels only, and swallows calibrated failures", async () => {
    const observe = vi.fn();
    const src = new RegionalPricingModePriceSource(legacy(), calibrated(), () => "SHADOW", observe);
    expect((await src.priceForLead("l")).kind).toBe("RESOLVED");
    expect(observe).toHaveBeenCalledTimes(1);
    const seen = JSON.stringify(observe.mock.calls[0]![0]);
    expect(seen).not.toMatch(/\d+\.\d{2}/); // no amounts

    const failing = new RegionalPricingModePriceSource(legacy(), calibrated("throw"), () => "SHADOW", observe);
    expect((await failing.priceForLead("l")).kind).toBe("RESOLVED");
  });

  it("a throwing or malformed mode reader reads as OFF", async () => {
    const cal = calibrated();
    for (const read of [() => { throw new Error("x"); }, () => "enforce" as never, () => undefined as never]) {
      const src = new RegionalPricingModePriceSource(legacy(), cal, read);
      expect((await src.priceForLead("l")).kind).toBe("RESOLVED");
    }
    expect((cal as { priceForLead: ReturnType<typeof vi.fn> }).priceForLead).not.toHaveBeenCalled();
  });

  it("the mode is read on every call (no cached switch)", async () => {
    let mode: "OFF" | "ENFORCE" = "OFF";
    const src = new RegionalPricingModePriceSource(legacy(), calibrated(), () => mode);
    expect((await src.priceForLead("l")).kind).toBe("RESOLVED");
    mode = "ENFORCE";
    expect(await src.priceForLead("l")).toEqual({ kind: "CONFIGURATION_UNAVAILABLE" });
  });
});

describe("M164 — publication routes below-threshold estimates to review", () => {
  const request = {
    id: "sr-1", customerId: "cust-1", categoryId: "cat", categoryName: "Fontanería", title: "Fuga", description: "Fuga en el baño", status: "PUBLISHED", urgency: "MEDIUM",
    budgetMin: null, budgetMax: null, location: { line1: "x", line2: null, city: "Madrid", province: "Madrid", postalCode: "28001", country: "ES", latitude: null, longitude: null },
    photos: [], createdAt: now, updatedAt: now,
  } as unknown as ServiceRequestRecord;
  const draft = (): LeadRecord => ({ id: "lead-1", serviceRequestId: "sr-1", status: "DRAFT", flowVersion: "LEAD_V1", maxBuyers: null, publication: null, createdAt: now, updatedAt: now }) as LeadRecord;

  function build(opts: { withReviews?: boolean } = {}) {
    const rows = new Map([["lead-1", draft()]]);
    const leads = {
      rows,
      create: vi.fn(),
      publish: vi.fn(async (id: string, snap: never) => {
        const row = rows.get(id)!;
        const next = withSnapshot(row, snap);
        rows.set(id, next);
        return next;
      }),
      findById: vi.fn(async (id: string) => rows.get(id) ?? null),
      findByServiceRequestId: vi.fn(),
    } as unknown as LeadRepository & { rows: Map<string, LeadRecord> };
    const reviews = reviewRepo();
    const source = new CalibratedLeadPublicationPriceSource(contexts(), regions(), resolved(), reviews);
    const uc = new PublishLeadUseCase(
      { findByUserId: vi.fn(async () => ({ id: "cust-1" })) } as never,
      { findById: vi.fn(async () => request) } as never,
      leads,
      source,
      TEST_BUYER_POLICY,
      undefined,
      opts.withReviews === false ? undefined : reviews,
    );
    return { uc, leads, reviews };
  }

  it("opens ONE review, tells the customer it is under review, and the lead stays DRAFT and unpriced", async () => {
    const { uc, leads, reviews } = build();
    await expect(uc.execute("user-1", "lead-1")).rejects.toBeInstanceOf(LeadPricingUnderReviewError);
    expect(leads.publish).not.toHaveBeenCalled();
    expect(leads.rows.get("lead-1")).toMatchObject({ status: "DRAFT", publication: null });
    expect(reviews.rows.size).toBe(1);
    expect([...reviews.rows.values()][0]).toMatchObject({ status: "PENDING_REVIEW", provinceCode: "28", categorySlug: "fontaneria" });
  });

  it("retrying is idempotent: no duplicate review, same error", async () => {
    const { uc, reviews } = build();
    await expect(uc.execute("user-1", "lead-1")).rejects.toBeInstanceOf(LeadPricingUnderReviewError);
    await expect(uc.execute("user-1", "lead-1")).rejects.toBeInstanceOf(LeadPricingUnderReviewError);
    expect(reviews.rows.size).toBe(1);
  });

  it("after approval the same retry publishes with the reviewed price and provenance", async () => {
    const { uc, leads, reviews } = build();
    await expect(uc.execute("user-1", "lead-1")).rejects.toBeInstanceOf(LeadPricingUnderReviewError);
    const review = [...reviews.rows.values()][0];
    await reviews.decide(review!.id, { outcome: "APPROVED", reviewedJobValue: "800.00", note: null }, ADMIN, now);
    const published = await uc.execute("user-1", "lead-1");
    expect(published.status).toBe("PUBLISHED");
    expect(leads.publish).toHaveBeenCalledTimes(1);
    expect(published.publication).toMatchObject({ price: "80.00", estimatedJobValue: "800.00" });
    expect(published.publication?.calibrationProvenance).toMatchObject({ source: "ADMIN_REVIEW", price: "80.00" });
  });

  it("after rejection the lead is refused, not repriced", async () => {
    const { uc, leads, reviews } = build();
    await expect(uc.execute("user-1", "lead-1")).rejects.toBeInstanceOf(LeadPricingUnderReviewError);
    await reviews.decide([...reviews.rows.values()][0]!.id, { outcome: "REJECTED", note: null }, ADMIN, now);
    await expect(uc.execute("user-1", "lead-1")).rejects.toMatchObject({ code: "LEAD_PUBLICATION_REJECTED", reason: "REVIEW_REJECTED" });
    expect(leads.publish).not.toHaveBeenCalled();
  });

  it("without a review port the request is refused (fail closed), never published", async () => {
    const { uc, leads } = build({ withReviews: false });
    await expect(uc.execute("user-1", "lead-1")).rejects.toMatchObject({ reason: "REVIEW_REQUIRED" });
    expect(leads.publish).not.toHaveBeenCalled();
  });

  it("a malformed review outcome is refused before anything is opened", async () => {
    const reviews = reviewRepo();
    const bad = fixedPriceSource({ kind: "REVIEW_REQUIRED", configVersion: "c", reasons: ["NOPE"], inputFingerprint: "short", categorySlug: "x", parentCategorySlug: null, provinceCode: "99", provenance: {} } as never);
    const rows = new Map([["lead-1", draft()]]);
    const leads = { rows, publish: vi.fn(), findById: vi.fn(async (id: string) => rows.get(id) ?? null) } as never;
    const uc = new PublishLeadUseCase({ findByUserId: vi.fn(async () => ({ id: "cust-1" })) } as never, { findById: vi.fn(async () => request) } as never, leads, bad, TEST_BUYER_POLICY, undefined, reviews);
    await expect(uc.execute("user-1", "lead-1")).rejects.toBeInstanceOf(LeadPublicationRejectedError);
    expect(reviews.openOrGet).not.toHaveBeenCalled();
  });
});

describe("M164 — administrator review use cases", () => {
  const admins = (roles: string[] = ["ADMIN"], status = "ACTIVE") => ({ getUserById: vi.fn(async () => ({ id: ADMIN, status, roles })) }) as never;

  async function seeded() {
    const reviews = reviewRepo();
    const src = new CalibratedLeadPublicationPriceSource(contexts(), regions(), resolved(), reviews);
    const first = await src.priceForLead("lead-1");
    if (first.kind !== "REVIEW_REQUIRED") throw new Error("expected review");
    const { review } = await reviews.openOrGet({ leadId: "lead-1", inputFingerprint: first.inputFingerprint, reasonCodes: first.reasons, categorySlug: "fontaneria", parentCategorySlug: null, provinceCode: "28", calibrationVersion: first.configVersion, provenance: first.provenance });
    return { reviews, review };
  }

  it("non-admins, suspended admins and unreadable actors are refused everywhere", async () => {
    const { reviews, review } = await seeded();
    for (const a of [admins(["PROFESSIONAL"]), admins(["ADMIN"], "SUSPENDED"), { getUserById: vi.fn(async () => { throw new Error("db"); }) } as never]) {
      await expect(new ListLeadPricingReviewsUseCase(a, reviews).execute(ADMIN)).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
      await expect(new GetLeadPricingReviewUseCase(a, reviews).execute(ADMIN, review.id)).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
      await expect(new DecideLeadPricingReviewUseCase(a, reviews, resolved(), () => now).execute(ADMIN, review.id, { outcome: "REJECTED" })).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
    }
    expect(reviews.decide).not.toHaveBeenCalled();
    await expect(new ListLeadPricingReviewsUseCase(admins(), reviews).execute("")).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
  });

  it("lists pending reviews by default and gets one by id", async () => {
    const { reviews, review } = await seeded();
    const listed = await new ListLeadPricingReviewsUseCase(admins(), reviews).execute(ADMIN);
    expect(listed.map((r) => r.id)).toEqual([review.id]);
    const got = await new GetLeadPricingReviewUseCase(admins(), reviews).execute(ADMIN, review.id);
    expect(got.provenance.reviewReasons).toContain("CALIBRATION_MISSING");
    await expect(new GetLeadPricingReviewUseCase(admins(), reviews).execute(ADMIN, "not-a-uuid")).rejects.toMatchObject({ reason: "INVALID_INPUT" });
    await expect(new GetLeadPricingReviewUseCase(admins(), reviews).execute(ADMIN, "00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ reason: "REVIEW_NOT_FOUND" });
  });

  it("approves with a value (never a price), records who and when", async () => {
    const { reviews, review } = await seeded();
    const decided = await new DecideLeadPricingReviewUseCase(admins(), reviews, resolved(), () => now).execute(ADMIN, review.id, { outcome: "APPROVED", reviewedJobValue: "450.00", note: "checked with pro" });
    expect(decided).toMatchObject({ status: "APPROVED", reviewedJobValue: "450.00", decidedByUserId: ADMIN, decidedAt: now });
  });

  it("repeating the same decision is idempotent; a different one is refused (a decision is final)", async () => {
    const { reviews, review } = await seeded();
    const uc = new DecideLeadPricingReviewUseCase(admins(), reviews, resolved(), () => now);
    await uc.execute(ADMIN, review.id, { outcome: "APPROVED", reviewedJobValue: "450.00" });
    const again = await uc.execute(ADMIN, review.id, { outcome: "APPROVED", reviewedJobValue: "450" });
    expect(again.status).toBe("APPROVED");
    expect(reviews.decide).toHaveBeenCalledTimes(1);
    await expect(uc.execute(ADMIN, review.id, { outcome: "REJECTED" })).rejects.toMatchObject({ reason: "ALREADY_DECIDED" });
    await expect(uc.execute(ADMIN, review.id, { outcome: "APPROVED", reviewedJobValue: "900.00" })).rejects.toMatchObject({ reason: "ALREADY_DECIDED" });
  });

  it("two concurrent admins: the first wins, the second sees a refusal or an idempotent repeat", async () => {
    const { reviews, review } = await seeded();
    const uc = new DecideLeadPricingReviewUseCase(admins(), reviews, resolved(), () => now);
    const [a, b] = await Promise.allSettled([
      uc.execute(ADMIN, review.id, { outcome: "APPROVED", reviewedJobValue: "450.00" }),
      uc.execute(ADMIN, review.id, { outcome: "REJECTED" }),
    ]);
    const states = [a, b].map((s) => s.status);
    expect(states.filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(reviews.rows.get(review.id)?.status).toMatch(/APPROVED|REJECTED/);
  });

  it.each([
    ["a value that would exceed the job-value limit", "99999.00", "VALUE_NOT_PRICEABLE"],
    ["a non-decimal value", "4e2", "INVALID_INPUT"],
    ["a negative value", "-1", "INVALID_INPUT"],
  ])("refuses an approval with %s", async (_n, value, reason) => {
    const { reviews, review } = await seeded();
    const uc = new DecideLeadPricingReviewUseCase(admins(), reviews, resolved(), () => now);
    await expect(uc.execute(ADMIN, review.id, { outcome: "APPROVED", reviewedJobValue: value })).rejects.toMatchObject({ reason });
    expect(reviews.rows.get(review.id)?.status).toBe("PENDING_REVIEW");
  });

  it("a review made under another calibration release is stale and cannot be approved", async () => {
    const { reviews, review } = await seeded();
    const other = resolved({ ...LEAD_REGIONAL_CALIBRATION_V1, calibrationVersion: "lead-regional-pricing-v2" });
    await expect(new DecideLeadPricingReviewUseCase(admins(), reviews, other, () => now).execute(ADMIN, review.id, { outcome: "APPROVED", reviewedJobValue: "450.00" })).rejects.toMatchObject({ reason: "REVIEW_STALE" });
  });

  it("approval requires a valid configuration; rejection does not", async () => {
    const { reviews, review } = await seeded();
    const none = { status: "INCOMPLETE", issues: [] } as never;
    const uc = new DecideLeadPricingReviewUseCase(admins(), reviews, none, () => now);
    await expect(uc.execute(ADMIN, review.id, { outcome: "APPROVED", reviewedJobValue: "450.00" })).rejects.toMatchObject({ reason: "CONFIGURATION_UNAVAILABLE" });
    expect((await uc.execute(ADMIN, review.id, { outcome: "REJECTED" })).status).toBe("REJECTED");
  });

  it("errors expose a reason and no stack-bearing internals", () => {
    const e = new LeadPricingReviewRejectedError("ALREADY_DECIDED");
    expect(e.reason).toBe("ALREADY_DECIDED");
  });
});
