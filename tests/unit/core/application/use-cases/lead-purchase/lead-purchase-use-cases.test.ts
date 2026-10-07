import { describe, expect, it, vi } from "vitest";

import { PRIVATE_CONTACT_FIELD_NAMES } from "@/application/dto/lead-contact.dto";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { NotFoundError, ProfessionalNotVerifiedError } from "@/domain/errors/domain-error";
import type { LeadPreviewCandidate } from "@/domain/repositories/lead-preview-repository";
import type { LeadRecord } from "@/domain/repositories/lead-repository";
import type { InitiateLeadPurchaseData, LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";
import {
  DuplicateActiveLeadPurchaseError,
  InvalidLeadPurchaseTransitionError,
  LeadBuyerLimitReachedError,
  LeadNotPurchasableError,
  assertLeadPurchaseTransition,
  hasBuyerCapacity,
  isActiveLeadPurchaseStatus,
  type LeadPurchaseStatus,
} from "@/domain/services/lead-purchase";

const USER = "pro-user";
const LEAD = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const OWNER_USER = "customer-user-secret";

const lead = (patch: Partial<LeadRecord> = {}): LeadRecord => ({
  id: LEAD,
  serviceRequestId: REQUEST,
  status: "PUBLISHED",
  flowVersion: "LEAD_V1",
  maxBuyers: null,
  publication: { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-06T10:00:00Z") },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...patch,
});
const request = (patch: Record<string, unknown> = {}) => ({
  id: REQUEST,
  customerId: "cust-1",
  status: "PUBLISHED",
  title: "Fuga",
  description: "Fuga en el baño",
  location: { city: "Madrid" },
  ...patch,
});
const preview = (patch: Partial<LeadPreviewCandidate> = {}): LeadPreviewCandidate => ({
  leadId: LEAD,
  title: "Fuga",
  description: "d",
  categoryId: "cat-1",
  categoryName: "Fontanería",
  urgency: "HIGH",
  city: "Madrid",
  province: "Madrid",
  latitude: 40.4168,
  longitude: -3.7038,
  customerUserId: OWNER_USER,
  createdAt: new Date(),
  ...patch,
});

/** In-memory repository that mirrors the Prisma semantics (snapshot copy, duplicate-before-capacity, maxBuyers, conditional transition). */
class FakePurchases implements LeadPurchaseRepository {
  rows: LeadPurchaseRecord[] = [];
  n = 0;
  constructor(
    private readonly maxBuyers: number | null = null,
    private readonly publication: unknown = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-06T10:00:00Z") },
  ) {}
  async create(): Promise<LeadPurchaseRecord> {
    throw new Error("not used by Module 126");
  }
  async initiate(d: InitiateLeadPurchaseData): Promise<LeadPurchaseRecord> {
    const fresh = pendingPurchaseFromPublication(`p-${this.n + 1}`, d.leadId, d.professionalProfileId, this.publication);
    const active = this.rows.filter((r) => r.leadId === d.leadId && isActiveLeadPurchaseStatus(r.status));
    if (active.some((r) => r.professionalProfileId === d.professionalProfileId)) throw new DuplicateActiveLeadPurchaseError();
    if (!hasBuyerCapacity(this.maxBuyers, active.length)) throw new LeadBuyerLimitReachedError();
    this.n += 1;
    this.rows.push(fresh);
    return { ...fresh };
  }
  async transition(id: string, from: LeadPurchaseStatus, to: LeadPurchaseStatus, now: Date) {
    assertLeadPurchaseTransition(from, to);
    const row = this.rows.find((r) => r.id === id && r.status === from);
    if (!row) return null;
    row.status = to;
    if (to === "CONFIRMED") row.confirmedAt = now;
    if (to === "REFUNDED") row.refundedAt = now;
    if (to === "REVOKED") row.revokedAt = now;
    return { ...row };
  }
  async findById(id: string) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async findActiveByLeadAndProfessional(leadId: string, pro: string) {
    return this.rows.find((r) => r.leadId === leadId && r.professionalProfileId === pro && isActiveLeadPurchaseStatus(r.status)) ?? null;
  }
  async findConfirmedByLeadAndProfessional(leadId: string, pro: string) {
    return this.rows.find((r) => r.leadId === leadId && r.professionalProfileId === pro && r.status === "CONFIRMED") ?? null;
  }
}

function build(opts: {
  professional?: Record<string, unknown> | null;
  candidate?: Record<string, unknown> | null;
  lead?: LeadRecord | null;
  request?: Record<string, unknown> | null;
  preview?: LeadPreviewCandidate | null;
  maxBuyers?: number | null;
} = {}) {
  const professionals = {
    findByUserId: vi.fn(async () =>
      opts.professional === null ? null : { id: "pro-1", status: "ACTIVE", verificationStatus: "VERIFIED", ...opts.professional },
    ),
  };
  const discovery = {
    findCandidateById: vi.fn(async () =>
      opts.candidate === null ? null : { id: "pro-1", categoryIds: ["cat-1"], latitude: 40.42, longitude: -3.7, serviceRadiusKm: 50, ...opts.candidate },
    ),
  };
  const leads = { findById: vi.fn(async () => (opts.lead === null ? null : (opts.lead ?? lead()))) };
  const serviceRequests = { findById: vi.fn(async () => (opts.request === null ? null : (opts.request ?? request()))) };
  const previews = { findPublishedById: vi.fn(async () => (opts.preview === null ? null : (opts.preview ?? preview()))), findPublishedByCategoryIds: vi.fn() };
  const purchases = new FakePurchases(opts.maxBuyers ?? null, (opts.lead ?? lead())?.publication);
  const initiate = new InitiateLeadPurchaseUseCase(
    professionals as never,
    discovery as never,
    leads as never,
    serviceRequests as never,
    previews as never,
    purchases,
  );
  const confirm = new ConfirmLeadPurchaseUseCase(purchases, leads as never, serviceRequests as never, () => new Date("2026-10-03T12:00:00Z"));
  const transition = new TransitionLeadPurchaseUseCase(purchases, () => new Date("2026-10-03T13:00:00Z"));
  return { initiate, confirm, transition, purchases, leads };
}

describe("InitiateLeadPurchaseUseCase", () => {
  it("creates a PENDING_PAYMENT purchase for a valid published LEAD_V1 lead, with a safe DTO", async () => {
    const b = build();
    const dto = await b.initiate.execute(USER, LEAD);
    expect(dto).toMatchObject({ leadId: LEAD, status: "PENDING_PAYMENT", price: Number(SNAPSHOT_DATA.price), currency: "EUR", confirmedAt: null });
    expect(Object.keys(dto).sort()).toEqual(["confirmedAt", "createdAt", "currency", "leadId", "price", "purchaseId", "status"]);
    const json = JSON.stringify(dto);
    expect(json).not.toContain(OWNER_USER);
    expect(json).not.toContain("pro-1");
    for (const k of PRIVATE_CONTACT_FIELD_NAMES) expect(Object.keys(dto)).not.toContain(k);
    expect(b.purchases.rows).toHaveLength(1);
  });

  it("the fee is the lead's immutable publication snapshot, never a caller or pricing-provider value (M135)", async () => {
    const b = build({ lead: lead({ publication: { ...SNAPSHOT_DATA, price: "7.25", publishedAt: new Date("2026-10-06T10:00:00Z") } }) });
    expect((await b.initiate.execute(USER, LEAD)).price).toBe(7.25);
    expect(b.initiate.execute.length).toBe(2); // (userId, leadId) only
    expect(b.initiate.constructor.length).toBe(6); // no price provider dependency any more
  });

  it.each([
    ["missing lead", { lead: null }],
    ["legacy lead", { lead: lead({ flowVersion: "LEGACY_QUOTE_PAYMENT" }) }],
    ["published lead without publication snapshot (pre-M133)", { lead: lead({ publication: null }) }],
    ["published lead with undefined snapshot", { lead: lead({ publication: undefined }) }],
    ["published lead with malformed snapshot", { lead: lead({ publication: { ...SNAPSHOT_DATA, price: "0.00", publishedAt: new Date() } }) }],
    ["draft lead", { lead: lead({ status: "DRAFT" }) }],
    ["closed lead", { lead: lead({ status: "CLOSED" }) }],
    ["expired lead", { lead: lead({ status: "EXPIRED" }) }],
    ["cancelled lead", { lead: lead({ status: "CANCELLED" }) }],
    ["missing request", { request: null }],
    ["request not open", { request: request({ status: "CANCELLED" }) }],
    ["request incomplete", { request: request({ title: " " }) }],
    ["not visible in preview", { preview: null }],
    ["customer buying own lead", { preview: preview({ customerUserId: USER }) }],
    ["professional out of category", { candidate: { categoryIds: ["other"] } }],
    ["professional out of radius", { candidate: { serviceRadiusKm: 1, latitude: 41.5, longitude: 2.1 } }],
    ["no discovery candidate", { candidate: null }],
    ["no professional profile", { professional: null }],
    ["suspended professional", { professional: { status: "SUSPENDED" } }],
  ])("%s -> the same safe LeadNotPurchasableError, nothing created", async (_name, opts) => {
    const b = build(opts as never);
    const err = await b.initiate.execute(USER, LEAD).catch((e) => e);
    expect(err).toBeInstanceOf(LeadNotPurchasableError);
    expect(err.message).toBe("This lead is not available for purchase.");
    expect(b.purchases.rows).toHaveLength(0);
  });

  it.each(["UNVERIFIED", "PENDING", "REJECTED"])("%s professional -> ProfessionalNotVerifiedError", async (verificationStatus) => {
    const b = build({ professional: { verificationStatus } });
    await expect(b.initiate.execute(USER, LEAD)).rejects.toBeInstanceOf(ProfessionalNotVerifiedError);
    expect(b.purchases.rows).toHaveLength(0);
  });

  it("persists exactly the publication snapshot's fee, currency and provenance on the purchase", async () => {
    const publishedAt = new Date("2026-10-06T10:00:00Z");
    const b = build({ lead: lead({ publication: { ...SNAPSHOT_DATA, price: "12.34", publishedAt } }) });
    const spy = vi.spyOn(b.purchases, "initiate");
    const dto = await b.initiate.execute(USER, LEAD);
    expect(spy).toHaveBeenCalledWith({ leadId: LEAD, professionalProfileId: "pro-1" }); // no price input at all
    expect(b.purchases.rows[0]).toMatchObject({
      price: 12.34,
      currency: "EUR",
      status: "PENDING_PAYMENT",
      financialSnapshot: {
        feeAmount: "12.34",
        currency: "EUR",
        taxAmount: null,
        totalAmount: null,
        pricingConfigVersion: SNAPSHOT_DATA.pricingConfigVersion,
        pricingRuleVersion: SNAPSHOT_DATA.pricingRuleVersion,
        leadPublishedAt: publishedAt,
      },
    });
    expect(dto.purchaseId).toBe(b.purchases.rows[0]!.id);
  });

  it("a later re-read of a differently priced lead does not alter an existing purchase snapshot", async () => {
    const b = build();
    await b.initiate.execute(USER, LEAD);
    const before = structuredClone(b.purchases.rows[0]!.financialSnapshot);
    // The lead is re-read with a different (hypothetically re-priced) snapshot: the stored purchase is untouched.
    (b.leads.findById as ReturnType<typeof vi.fn>).mockImplementation(async () => lead({ publication: { ...SNAPSHOT_DATA, price: "99.00", publishedAt: new Date("2026-11-01T00:00:00Z") } }));
    expect(b.purchases.rows[0]!.financialSnapshot).toEqual(before);
    expect(b.purchases.rows[0]!.price).toBe(Number(SNAPSHOT_DATA.price));
  });

  it("a successful initiation does not authorize contact (PENDING_PAYMENT is not a contact candidate)", async () => {
    const b = build();
    const dto = await b.initiate.execute(USER, LEAD);
    expect(dto.status).toBe("PENDING_PAYMENT");
    expect(await b.purchases.findConfirmedByLeadAndProfessional(LEAD, "pro-1")).toBeNull();
  });

  it("malformed ids are rejected before any lookup", async () => {
    const b = build();
    for (const bad of ["", "not-a-uuid", undefined as never]) {
      await expect(b.initiate.execute(USER, bad)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    }
    await expect(b.initiate.execute("", LEAD)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect(b.leads.findById).not.toHaveBeenCalled();
  });

  it("repeated identical initiation while PENDING_PAYMENT returns the SAME purchase (idempotent), no second row", async () => {
    const b = build();
    const first = await b.initiate.execute(USER, LEAD);
    const again = await b.initiate.execute(USER, LEAD);
    expect(again).toEqual(first);
    expect(b.purchases.rows).toHaveLength(1);
  });

  it("an already CONFIRMED purchase is a duplicate (error), and a retry after FAILED/CANCELLED creates a NEW purchase", async () => {
    const b = build();
    const first = await b.initiate.execute(USER, LEAD);
    await b.confirm.execute(first.purchaseId);
    await expect(b.initiate.execute(USER, LEAD)).rejects.toBeInstanceOf(DuplicateActiveLeadPurchaseError);
    expect(b.purchases.rows).toHaveLength(1);

    const c = build();
    const p = await c.initiate.execute(USER, LEAD);
    await c.transition.execute(p.purchaseId, "FAILED");
    const retry = await c.initiate.execute(USER, LEAD);
    expect(retry.purchaseId).not.toBe(p.purchaseId);
    expect(c.purchases.rows.filter((r) => isActiveLeadPurchaseStatus(r.status))).toHaveLength(1);
  });

  it("concurrent identical initiations create exactly one active purchase and all callers get that purchase", async () => {
    const b = build();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => b.initiate.execute(USER, LEAD)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ purchaseId: string }>).value.purchaseId));
    expect(ids.size).toBe(1);
    expect(b.purchases.rows.filter((r) => isActiveLeadPurchaseStatus(r.status))).toHaveLength(1);
  });

  it("lost race: the repository reports a duplicate -> the use case returns the winning PENDING purchase", async () => {
    const b = build();
    const winner = await b.purchases.initiate({ leadId: LEAD, professionalProfileId: "pro-1" });
    // The early check misses (read happened before the winner committed); the locked insert then reports the duplicate.
    const find = vi.spyOn(b.purchases, "findActiveByLeadAndProfessional").mockResolvedValueOnce(null);
    const dto = await b.initiate.execute(USER, LEAD);
    expect(find).toHaveBeenCalledTimes(2);
    expect(dto.purchaseId).toBe(winner.id);
    expect(b.purchases.rows).toHaveLength(1);
  });

  it("different professionals purchase the same lead independently while the lead's buyer policy allows it", async () => {
    const b = build({ maxBuyers: 2 });
    await b.initiate.execute(USER, LEAD);
    const other = new InitiateLeadPurchaseUseCase(
      { findByUserId: async () => ({ id: "pro-2", status: "ACTIVE", verificationStatus: "VERIFIED" }) } as never,
      { findCandidateById: async () => ({ id: "pro-2", categoryIds: ["cat-1"], latitude: 40.42, longitude: -3.7, serviceRadiusKm: 50 }) } as never,
      b.leads as never,
      { findById: async () => request() } as never,
      { findPublishedById: async () => preview(), findPublishedByCategoryIds: vi.fn() } as never,
      b.purchases,
    );
    const second = await other.execute("pro-user-2", LEAD);
    expect(second.status).toBe("PENDING_PAYMENT");
    expect(b.purchases.rows.map((r) => r.professionalProfileId).sort()).toEqual(["pro-1", "pro-2"]);
    // The lead's buyer policy stays authoritative: a third buyer is refused.
    const third = build({ maxBuyers: 1 });
    await third.initiate.execute(USER, LEAD);
    third.purchases.rows[0]!.professionalProfileId = "someone-else";
    await expect(third.initiate.execute(USER, LEAD)).rejects.toBeInstanceOf(LeadBuyerLimitReachedError);
  });

  it("an exclusive lead (maxBuyers 1) still reports the buyer's own concurrent retry as the same purchase, not 'limit reached'", async () => {
    const b = build({ maxBuyers: 1 });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => b.initiate.execute(USER, LEAD)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(b.purchases.rows).toHaveLength(1);
  });

  it("surfaces LeadBuyerLimitReachedError from the repository when maxBuyers is reached", async () => {
    const b = build({ maxBuyers: 1 });
    b.purchases.rows.push({
      id: "other",
      leadId: LEAD,
      professionalProfileId: "pro-other",
      status: "CONFIRMED",
      price: 1,
      currency: "EUR",
      financialSnapshot: { feeAmount: "1.00", currency: "EUR", taxAmount: null, totalAmount: null, pricingConfigVersion: null, pricingRuleVersion: null, leadPublishedAt: null },
      confirmedAt: new Date(),
      refundedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(b.initiate.execute(USER, LEAD)).rejects.toBeInstanceOf(LeadBuyerLimitReachedError);
  });
});

describe("ConfirmLeadPurchaseUseCase", () => {
  async function pending(opts: Parameters<typeof build>[0] = {}) {
    const b = build(opts);
    const dto = await b.initiate.execute(USER, LEAD);
    return { b, id: dto.purchaseId };
  }

  it("PENDING_PAYMENT -> CONFIRMED and sets confirmedAt", async () => {
    const { b, id } = await pending();
    const dto = await b.confirm.execute(id);
    expect(dto.status).toBe("CONFIRMED");
    expect(dto.confirmedAt).toEqual(new Date("2026-10-03T12:00:00Z"));
  });

  it("is idempotent: confirming twice keeps one purchase and the first confirmedAt", async () => {
    const { b, id } = await pending();
    const first = await b.confirm.execute(id);
    const later = new ConfirmLeadPurchaseUseCase(b.purchases, b.leads as never, { findById: async () => request() } as never, () => new Date("2027-01-01T00:00:00Z"));
    const second = await later.execute(id);
    expect(second).toEqual(first);
    expect(b.purchases.rows).toHaveLength(1);
  });

  it("concurrent confirmations transition exactly once", async () => {
    const { b, id } = await pending();
    const spy = vi.spyOn(b.purchases, "transition");
    const results = await Promise.all(Array.from({ length: 5 }, () => b.confirm.execute(id)));
    for (const r of results) expect(r.status).toBe("CONFIRMED");
    expect(new Set(results.map((r) => String(r.confirmedAt))).size).toBe(1);
    expect(b.purchases.rows[0]!.status).toBe("CONFIRMED");
    expect(spy.mock.results.length).toBeGreaterThanOrEqual(1);
  });

  it("missing purchase -> NotFoundError", async () => {
    await expect(build().confirm.execute("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each(["FAILED", "CANCELLED"] as const)("a %s purchase can never be confirmed", async (terminal) => {
    const { b, id } = await pending();
    await b.transition.execute(id, terminal);
    await expect(b.confirm.execute(id)).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    expect(b.purchases.rows[0]!.status).toBe(terminal);
  });

  it.each(["REFUNDED", "REVOKED"] as const)("a %s purchase can never be re-confirmed", async (terminal) => {
    const { b, id } = await pending();
    await b.confirm.execute(id);
    await b.transition.execute(id, terminal);
    await expect(b.confirm.execute(id)).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    expect(b.purchases.rows[0]!.status).toBe(terminal);
  });

  it("race: a terminal transition that wins between read and write is not overwritten", async () => {
    const { b, id } = await pending();
    const original = b.purchases.findById.bind(b.purchases);
    let first = true;
    vi.spyOn(b.purchases, "findById").mockImplementation(async (x: string) => {
      const row = await original(x);
      if (first && row) {
        first = false;
        b.purchases.rows[0]!.status = "CANCELLED"; // concurrent cancel after our read
      }
      return row;
    });
    await expect(b.confirm.execute(id)).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    expect(b.purchases.rows[0]!.status).toBe("CANCELLED");
    expect(b.purchases.rows[0]!.confirmedAt).toBeNull();
  });

  it.each([
    ["lead closed", { status: "CLOSED" as const }],
    ["lead cancelled", { status: "CANCELLED" as const }],
    ["legacy flow", { flowVersion: "LEGACY_QUOTE_PAYMENT" as const }],
  ])("does not confirm when the %s", async (_n, patch) => {
    const { b, id } = await pending();
    (b.leads.findById as ReturnType<typeof vi.fn>).mockImplementation(async () => lead(patch));
    await expect(b.confirm.execute(id)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect(b.purchases.rows[0]!.status).toBe("PENDING_PAYMENT");
  });
});

describe("TransitionLeadPurchaseUseCase", () => {
  it.each([
    ["PENDING_PAYMENT", "FAILED"],
    ["PENDING_PAYMENT", "CANCELLED"],
    ["CONFIRMED", "REFUNDED"],
    ["CONFIRMED", "REVOKED"],
  ] as const)("%s -> %s, idempotent when repeated", async (from, to) => {
    const b = build();
    const { purchaseId } = await b.initiate.execute(USER, LEAD);
    if (from === "CONFIRMED") await b.confirm.execute(purchaseId);
    const first = await b.transition.execute(purchaseId, to);
    expect(first.status).toBe(to);
    const again = await b.transition.execute(purchaseId, to);
    expect(again).toEqual(first);
  });

  it("stamps refundedAt / revokedAt once", async () => {
    const b = build();
    const { purchaseId } = await b.initiate.execute(USER, LEAD);
    await b.confirm.execute(purchaseId);
    await b.transition.execute(purchaseId, "REVOKED");
    expect(b.purchases.rows[0]).toMatchObject({ status: "REVOKED", revokedAt: new Date("2026-10-03T13:00:00Z"), refundedAt: null });
  });

  it("rejects invalid moves and CONFIRMED/PENDING_PAYMENT as a target", async () => {
    const b = build();
    const { purchaseId } = await b.initiate.execute(USER, LEAD);
    await expect(b.transition.execute(purchaseId, "REFUNDED")).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    await expect(b.transition.execute(purchaseId, "CONFIRMED")).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    await expect(b.transition.execute(purchaseId, "PENDING_PAYMENT")).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    await b.transition.execute(purchaseId, "FAILED");
    await expect(b.transition.execute(purchaseId, "CANCELLED")).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    expect(b.purchases.rows[0]!.status).toBe("FAILED");
  });

  it("missing purchase -> NotFoundError", async () => {
    await expect(build().transition.execute("nope", "FAILED")).rejects.toBeInstanceOf(NotFoundError);
  });
});
