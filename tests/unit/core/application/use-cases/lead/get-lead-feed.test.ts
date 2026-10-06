import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/domain/errors/domain-error";
import type { LeadFeedCandidate, LeadFeedPageQuery, LeadFeedRepository } from "@/domain/repositories/lead-feed-repository";
import { PRIVATE_CONTACT_FIELD_NAMES } from "@/application/dto/lead-contact.dto";
import {
  GetLeadFeedForProfessionalUseCase,
  LEAD_FEED_MAX_SCAN_BATCHES,
  decodeLeadFeedCursor,
  encodeLeadFeedCursor,
} from "@/application/use-cases/lead/get-lead-feed.use-case";
import { LEAD_BUYER_POLICY_PILOT_V1 } from "@/infrastructure/lead-publication/lead-buyer-policy-pilot.v1";
import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";

const PRO_USER = "pro-user";
const SECRET_USER = "customer-user-secret";
const CAT = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_CAT = "223e4567-e89b-12d3-a456-426614174000";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 10, minute, 0));

const publication = (patch: Record<string, unknown> = {}, publishedAt = at(0)) => ({ ...SNAPSHOT_DATA, publishedAt, ...patch });

const candidate = (n: number, patch: Partial<LeadFeedCandidate> = {}, publishedAt = at(n)): LeadFeedCandidate => ({
  leadId: id(n),
  position: { publishedAt, leadId: id(n) },
  leadStatus: "PUBLISHED",
  flowVersion: "LEAD_V1",
  requestStatus: "PUBLISHED",
  requestDeleted: false,
  publication: publication({}, publishedAt),
  title: "Fuga",
  description: "Fuga en el baño",
  categoryId: CAT,
  categoryName: "Fontanería",
  urgency: "HIGH",
  city: "Madrid",
  province: "Madrid",
  latitude: 40.4168,
  longitude: -3.7038,
  customerUserId: SECRET_USER,
  ...patch,
});

/** Fake of the repository contract: honours category filter, own-request exclusion and the keyset order. */
function fakeFeed(rows: LeadFeedCandidate[]) {
  const findPage = vi.fn(async (q: LeadFeedPageQuery) => {
    const sorted = [...rows].sort((a, b) => b.position.publishedAt.getTime() - a.position.publishedAt.getTime() || (a.leadId < b.leadId ? 1 : -1));
    return sorted
      .filter((r) => q.categoryIds.includes(r.categoryId) && r.customerUserId !== q.excludeCustomerUserId)
      .filter((r) => {
        if (!q.after) return true;
        const t = r.position.publishedAt.getTime();
        const a = q.after.publishedAt.getTime();
        return t < a || (t === a && r.leadId < q.after.leadId);
      })
      .slice(0, q.take);
  });
  const repo: LeadFeedRepository = { findPage };
  return { repo, findPage };
}

const proCandidate = { id: "pro-1", categoryIds: [CAT], latitude: 40.42, longitude: -3.7, serviceRadiusKm: 50 };

function build(rows: LeadFeedCandidate[], opts: { professional?: boolean; active?: boolean; pro?: Partial<typeof proCandidate> } = {}) {
  const professionals = { findByUserId: vi.fn(async () => (opts.professional === false ? null : { id: "pro-1" })) };
  const discovery = { findCandidateById: vi.fn(async () => (opts.active === false ? null : { ...proCandidate, ...opts.pro })) };
  const { repo, findPage } = fakeFeed(rows);
  return { useCase: new GetLeadFeedForProfessionalUseCase(professionals as never, discovery as never, repo), professionals, discovery, findPage };
}

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("Lead Feed v2 — eligibility", () => {
  it("includes a LEAD_V1 published lead with a valid snapshot", async () => {
    const { useCase } = build([candidate(1)]);
    const page = await useCase.execute(PRO_USER);
    expect(page.items.map((i) => i.leadId)).toEqual([id(1)]);
    expect(page.nextCursor).toBeNull();
  });

  const excluded: [string, Partial<LeadFeedCandidate>][] = [
    ["legacy flow", { flowVersion: "LEGACY_QUOTE_PAYMENT" }],
    ["missing flow", { flowVersion: "" }],
    ["draft lead", { leadStatus: "DRAFT" }],
    ["cancelled lead", { leadStatus: "CANCELLED" }],
    ["expired lead", { leadStatus: "EXPIRED" }],
    ["closed lead", { leadStatus: "CLOSED" }],
    ["request expired", { requestStatus: "EXPIRED" }],
    ["request cancelled", { requestStatus: "CANCELLED" }],
    ["request closed/completed", { requestStatus: "COMPLETED" }],
    ["request not yet published", { requestStatus: "DRAFT" }],
    ["deleted request", { requestDeleted: true }],
    ["incomplete request (blank title)", { title: "  " }],
    ["incomplete request (blank description)", { description: "" }],
    ["incomplete request (blank city)", { city: "" }],
    ["published lead without snapshot", { publication: null }],
    ["malformed snapshot: zero price", { publication: publication({ price: "0.00" }) }],
    ["malformed snapshot: wrong currency", { publication: publication({ currency: "USD" }) }],
    ["malformed snapshot: missing config version", { publication: publication({ pricingConfigVersion: null }) }],
    ["malformed snapshot: invalid buyer policy", { publication: publication({ maxBuyers: 0 }) }],
    ["malformed snapshot: missing publishedAt", { publication: { ...SNAPSHOT_DATA } }],
    ["malformed snapshot: unparsable price", { publication: publication({ price: "abc" }) }],
  ];

  it.each(excluded)("excludes: %s", async (_name, patch) => {
    const { useCase } = build([candidate(1, patch), candidate(2)]);
    const page = await useCase.execute(PRO_USER);
    expect(page.items.map((i) => i.leadId)).toEqual([id(2)]);
  });

  it("excludes the professional's own request, out-of-radius leads and leads without coordinates", async () => {
    const { useCase } = build([
      candidate(1, { customerUserId: PRO_USER }),
      candidate(2, { latitude: 41.38, longitude: 2.17 }), // Barcelona, > 50 km from the professional
      candidate(3, { latitude: null, longitude: null }),
      candidate(4),
    ]);
    expect((await useCase.execute(PRO_USER)).items.map((i) => i.leadId)).toEqual([id(4)]);
  });

  it("returns an empty page for a non-professional or inactive professional (no signal)", async () => {
    expect(await build([candidate(1)], { professional: false }).useCase.execute(PRO_USER)).toEqual({ items: [], nextCursor: null });
    expect(await build([candidate(1)], { active: false }).useCase.execute(PRO_USER)).toEqual({ items: [], nextCursor: null });
    const noCats = build([candidate(1)], { pro: { categoryIds: [] } });
    expect(await noCats.useCase.execute(PRO_USER)).toEqual({ items: [], nextCursor: null });
    expect(noCats.findPage).not.toHaveBeenCalled();
  });

  it("category filter is intersected with the professional's own categories", async () => {
    const rows = [candidate(1), candidate(2, { categoryId: OTHER_CAT })];
    const { useCase, findPage } = build(rows);
    expect((await useCase.execute(PRO_USER, { categoryId: OTHER_CAT })).items).toEqual([]);
    expect(findPage).not.toHaveBeenCalled();
    expect((await useCase.execute(PRO_USER, { categoryId: CAT })).items.map((i) => i.leadId)).toEqual([id(1)]);
    expect(findPage.mock.calls[0]![0].categoryIds).toEqual([CAT]);
    await expect(useCase.execute(PRO_USER, { categoryId: "nope" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Lead Feed v2 — snapshot price and buyer policy", () => {
  it("returns the immutable snapshot price/currency and the published buyer policy", async () => {
    const { useCase } = build([candidate(1, { publication: publication({ price: "27.50", maxBuyers: 3 }) })]);
    const [item] = (await useCase.execute(PRO_USER)).items;
    expect(item).toMatchObject({ price: "27.50", currency: "EUR", buyerPolicy: { maxBuyers: 3 } });
    expect(item!.publishedAt).toEqual(at(0));
  });

  it("two leads published under different pricing configurations keep their own snapshot price", async () => {
    const { useCase } = build([
      candidate(1, { publication: publication({ price: "18.00", pricingConfigVersion: "cfg-old" }, at(1)) }),
      candidate(2, { publication: publication({ price: "21.00", pricingConfigVersion: "cfg-new" }, at(2)) }),
    ]);
    expect((await useCase.execute(PRO_USER)).items.map((i) => [i.leadId, i.price])).toEqual([
      [id(2), "21.00"],
      [id(1), "18.00"],
    ]);
  });

  it("reflects the M133 pilot policy value unchanged (maxBuyers 1) and exposes no remaining-capacity or purchase fields", async () => {
    expect(LEAD_BUYER_POLICY_PILOT_V1.maxBuyers).toBe(1);
    const { useCase } = build([candidate(1, { publication: publication({ maxBuyers: LEAD_BUYER_POLICY_PILOT_V1.maxBuyers }) })]);
    const [item] = (await useCase.execute(PRO_USER)).items;
    expect(item!.buyerPolicy).toEqual({ maxBuyers: 1 });
    const keys = keysDeep(item);
    for (const k of ["remaining", "available", "purchasable", "buyerCount", "purchases", "leadPurchase", "status"]) expect(keys).not.toContain(k);
  });

  it("does not expose internal pricing mechanics", async () => {
    const [item] = (await build([candidate(1)]).useCase.execute(PRO_USER)).items;
    const keys = keysDeep(item);
    for (const k of ["estimatedJobValue", "pricingRate", "pricingConfidence", "pricingConfigVersion", "jobValueRuleVersion", "pricingRuleVersion", "buyerPolicyVersion"]) {
      expect(keys).not.toContain(k);
    }
  });
});

describe("Lead Feed v2 — contact protection", () => {
  it("exposes exactly the whitelisted marketplace fields", async () => {
    const [item] = (await build([candidate(1)]).useCase.execute(PRO_USER)).items;
    expect(Object.keys(item!).sort()).toEqual(
      ["buyerPolicy", "categoryId", "categoryName", "city", "currency", "description", "distanceKm", "leadId", "price", "province", "publishedAt", "title", "urgency"].sort(),
    );
  });

  it("never leaks contact, coordinates, owner id, address, payment or purchase data, even from an over-fetched candidate", async () => {
    const leaky = { ...candidate(1), email: "c@x.es", phone: "+34600000000", addressLine1: "Calle 1", postalCode: "28001", payment: { id: "p" }, purchases: [{ id: "x" }] };
    const { items } = await build([leaky as LeadFeedCandidate]).useCase.execute(PRO_USER);
    const keys = keysDeep(items);
    for (const forbidden of [...PRIVATE_CONTACT_FIELD_NAMES, "purchases", "leadPurchase", "payment", "serviceRequestId", "position", "publication"]) {
      expect(keys).not.toContain(forbidden);
    }
    const json = JSON.stringify(items);
    for (const secret of [SECRET_USER, "c@x.es", "+34600000000", "Calle 1", "28001", "40.4168", "-3.7038"]) expect(json).not.toContain(secret);
  });
});

describe("Lead Feed v2 — pagination and ordering", () => {
  const rows = [candidate(1), candidate(2), candidate(3), candidate(4), candidate(5)];

  it("orders by publishedAt DESC then leadId DESC (stable around identical timestamps)", async () => {
    const same = at(9);
    const tied = [candidate(10, {}, same), candidate(12, {}, same), candidate(11, {}, same), candidate(1)];
    const { useCase } = build(tied);
    expect((await useCase.execute(PRO_USER)).items.map((i) => i.leadId)).toEqual([id(12), id(11), id(10), id(1)]);
  });

  it("pages through the feed with no duplicates and no gaps, including across identical timestamps", async () => {
    const same = at(9);
    const all = [...rows, candidate(10, {}, same), candidate(11, {}, same), candidate(12, {}, same)];
    const { useCase } = build(all);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await useCase.execute(PRO_USER, { limit: 2, cursor });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.leadId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual([id(12), id(11), id(10), id(5), id(4), id(3), id(2), id(1)]);
    expect(cursor).toBeNull();
  });

  it("first page returns nextCursor only when more eligible leads exist", async () => {
    const { useCase } = build(rows);
    const first = await useCase.execute(PRO_USER, { limit: 2 });
    expect(first.items.map((i) => i.leadId)).toEqual([id(5), id(4)]);
    expect(first.nextCursor).toBe(encodeLeadFeedCursor({ publishedAt: at(4), leadId: id(4) }));
    const exact = await useCase.execute(PRO_USER, { limit: 5 });
    expect(exact.items).toHaveLength(5);
    expect(exact.nextCursor).toBeNull();
  });

  it("is deterministic: the same request returns the same page", async () => {
    const { useCase } = build(rows);
    expect(await useCase.execute(PRO_USER, { limit: 3 })).toEqual(await useCase.execute(PRO_USER, { limit: 3 }));
  });

  it("skips ineligible rows without dropping eligible ones, and a spent scan budget yields a continuation cursor", async () => {
    const junkCount = 2 * 5 * LEAD_FEED_MAX_SCAN_BATCHES; // newer than the single eligible lead
    const junk = Array.from({ length: junkCount }, (_, i) => candidate(100 + i, { flowVersion: "LEGACY_QUOTE_PAYMENT" }, at(30 + i % 20)));
    const { useCase, findPage } = build([...junk, candidate(1)]);
    const first = await useCase.execute(PRO_USER, { limit: 2 });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    expect(findPage.mock.calls.length).toBeLessThanOrEqual(LEAD_FEED_MAX_SCAN_BATCHES);
    let cursor = first.nextCursor;
    let found: string[] = [];
    for (let i = 0; i < 10 && cursor && found.length === 0; i += 1) {
      const page = await useCase.execute(PRO_USER, { limit: 2, cursor });
      found = page.items.map((x) => x.leadId);
      cursor = page.nextCursor;
    }
    expect(found).toEqual([id(1)]);
  });

  it("cursor round-trips and rejects tampered or malformed values", () => {
    const position = { publishedAt: at(7), leadId: id(7) };
    expect(decodeLeadFeedCursor(encodeLeadFeedCursor(position))).toEqual(position);
    for (const bad of ["", "not-a-cursor", Buffer.from("2026-10-06|x").toString("base64url"), Buffer.from(`nope|${id(1)}`).toString("base64url"), Buffer.from(`${at(1).toISOString()}|${id(1)}|extra`).toString("base64url")]) {
      expect(() => decodeLeadFeedCursor(bad)).toThrow(ValidationError);
    }
  });

  it("validates the page size", async () => {
    const { useCase } = build(rows);
    for (const limit of [0, -1, 51, 1.5, Number.NaN]) await expect(useCase.execute(PRO_USER, { limit })).rejects.toBeInstanceOf(ValidationError);
    await expect(useCase.execute(PRO_USER, { cursor: "garbage" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Lead Feed v2 — identity", () => {
  it("resolves the professional from the given (session) user id and excludes that user's own requests at query level", async () => {
    const { useCase, professionals, findPage } = build([candidate(1)]);
    await useCase.execute(PRO_USER);
    expect(professionals.findByUserId).toHaveBeenCalledWith(PRO_USER);
    expect(findPage.mock.calls[0]![0].excludeCustomerUserId).toBe(PRO_USER);
  });
});
