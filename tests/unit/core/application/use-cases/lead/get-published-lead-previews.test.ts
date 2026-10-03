import { describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/domain/errors/domain-error";
import type { LeadPreviewCandidate, LeadPreviewRepository } from "@/domain/repositories/lead-preview-repository";
import { PRIVATE_CONTACT_FIELD_NAMES } from "@/application/dto/lead-contact.dto";
import {
  GetPublishedLeadPreviewUseCase,
  GetPublishedLeadPreviewsForProfessionalUseCase,
} from "@/application/use-cases/lead/get-published-lead-previews.use-case";

const PRO_USER = "pro-user";
const LEAD = "11111111-1111-4111-8111-111111111111";
const SECRET_USER = "customer-user-secret";

const candidate = (patch: Partial<LeadPreviewCandidate> = {}): LeadPreviewCandidate => ({
  leadId: LEAD,
  title: "Fuga",
  description: "Fuga en el baño",
  categoryId: "cat-1",
  categoryName: "Fontanería",
  urgency: "HIGH",
  city: "Madrid",
  province: "Madrid",
  latitude: 40.4168,
  longitude: -3.7038,
  customerUserId: SECRET_USER,
  createdAt: new Date("2026-10-03T10:00:00Z"),
  ...patch,
});

const proCandidate = { id: "pro-1", categoryIds: ["cat-1"], latitude: 40.42, longitude: -3.7, serviceRadiusKm: 50 };

function build(opts: { professional?: boolean; active?: boolean; leads?: LeadPreviewCandidate[]; pro?: Partial<typeof proCandidate> } = {}) {
  const professionals = { findByUserId: vi.fn(async () => (opts.professional === false ? null : { id: "pro-1" })) };
  const discovery = { findCandidateById: vi.fn(async () => (opts.active === false ? null : { ...proCandidate, ...opts.pro })) };
  const leads = opts.leads ?? [candidate()];
  const previews: LeadPreviewRepository = {
    findPublishedById: vi.fn(async (id: string) => leads.find((l) => l.leadId === id) ?? null),
    findPublishedByCategoryIds: vi.fn(async (ids: string[]) => leads.filter((l) => ids.includes(l.categoryId))),
  };
  return {
    list: new GetPublishedLeadPreviewsForProfessionalUseCase(professionals as never, discovery as never, previews),
    one: new GetPublishedLeadPreviewUseCase(professionals as never, discovery as never, previews),
    previews,
  };
}

/** Deep key scan: no private key may appear at any depth. */
function keysDeep(value: unknown, out: string[] = []): string[] {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("Lead preview use cases", () => {
  it("returns a published lead for an eligible professional with only whitelisted fields", async () => {
    const [dto] = await build().list.execute(PRO_USER);
    expect(Object.keys(dto!).sort()).toEqual(
      ["categoryId", "categoryName", "city", "createdAt", "description", "distanceKm", "leadId", "province", "title", "urgency"].sort(),
    );
    expect(dto!.leadId).toBe(LEAD);
  });

  it("never leaks contact, coordinates, owner id, address or purchase data", async () => {
    const { list, one } = build();
    const results = [...(await list.execute(PRO_USER)), await one.execute(PRO_USER, LEAD)];
    for (const dto of results) {
      const keys = keysDeep(dto);
      for (const forbidden of [...PRIVATE_CONTACT_FIELD_NAMES, "purchases", "leadPurchase", "status", "serviceRequestId", "maxBuyers", "price"]) {
        expect(keys).not.toContain(forbidden);
      }
      expect(JSON.stringify(dto)).not.toContain(SECRET_USER);
      expect(JSON.stringify(dto)).not.toContain("40.4168");
    }
  });

  it("returns [] / NotFound for a user without an active professional profile", async () => {
    for (const opts of [{ professional: false }, { active: false }]) {
      const b = build(opts);
      expect(await b.list.execute(PRO_USER)).toEqual([]);
      await expect(b.one.execute(PRO_USER, LEAD)).rejects.toBeInstanceOf(NotFoundError);
      expect(b.previews.findPublishedById).not.toHaveBeenCalled();
      expect(b.previews.findPublishedByCategoryIds).not.toHaveBeenCalled();
    }
  });

  it("excludes the professional's own request and out-of-radius / wrong-category leads", async () => {
    const own = candidate({ customerUserId: PRO_USER });
    const far = candidate({ leadId: "22222222-2222-4222-8222-222222222222", latitude: 41.38, longitude: 2.17 });
    const otherCat = candidate({ leadId: "33333333-3333-4333-8333-333333333333", categoryId: "cat-2" });
    const b = build({ leads: [own, far, otherCat] });
    expect(await b.list.execute(PRO_USER)).toEqual([]);
    await expect(b.one.execute(PRO_USER, own.leadId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(b.one.execute(PRO_USER, far.leadId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("single preview: malformed id and unknown/invisible lead are the same NotFoundError (no DB lookup for malformed)", async () => {
    const b = build({ leads: [] });
    await expect(b.one.execute(PRO_USER, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(b.one.execute(PRO_USER, LEAD)).rejects.toBeInstanceOf(NotFoundError);
    expect(b.previews.findPublishedById).toHaveBeenCalledTimes(1);
  });

  it("error messages carry no customer data", async () => {
    const b = build({ leads: [candidate({ customerUserId: PRO_USER })] });
    const err = await b.one.execute(PRO_USER, LEAD).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(SECRET_USER);
  });
});
