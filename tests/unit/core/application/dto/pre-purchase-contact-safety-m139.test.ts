import { describe, expect, it, vi } from "vitest";

import { toLeadFeedItemDto } from "@/application/dto/lead-feed.dto";
import { toLeadPreviewDto } from "@/application/dto/lead-contact.dto";
import { toLeadPurchaseDto } from "@/application/dto/lead-purchase.dto";
import { GetLeadFeedForProfessionalUseCase } from "@/application/use-cases/lead/get-lead-feed.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import type { LeadFeedCandidate } from "@/domain/repositories/lead-feed-repository";
import type { LeadPreviewCandidate } from "@/domain/repositories/lead-preview-repository";
import type { LeadRecord } from "@/domain/repositories/lead-repository";
import type { InitiateLeadPurchaseData, LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import {
  LeadContactAccessDeniedError,
  canProfessionalAccessLeadContact,
  type LeadContactAuthorizationFacts,
} from "@/domain/services/lead-contact-access-policy";
import {
  LEAD_PURCHASE_STATUSES,
  assertLeadPurchaseTransition,
  isActiveLeadPurchaseStatus,
  toLeadContactGrantState,
  type LeadPurchaseStatus,
} from "@/domain/services/lead-purchase";

import { SNAPSHOT_DATA } from "../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../test-utils/lead-purchase-fixtures";
import {
  M139_SECRET_ADDRESS,
  M139_SECRET_EMAIL,
  M139_SECRET_NAME,
  M139_SECRET_PHONE,
  M139_SECRET_POSTAL_CODE,
  assertNoContactLeak,
  collectKeys,
} from "../../../../test-utils/contact-leak-sentinels";

const PRO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEAD = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_USER = "customer-user-m139";
const PUBLISHED_AT = new Date("2026-10-06T10:00:00Z");
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: PUBLISHED_AT };

/** An over-fetched row: everything a careless query could drag along, sentinels included. */
const OVERFETCH = {
  email: M139_SECRET_EMAIL,
  phone: M139_SECRET_PHONE,
  line1: M139_SECRET_ADDRESS,
  addressLine1: M139_SECRET_ADDRESS,
  postalCode: M139_SECRET_POSTAL_CODE,
  customerName: M139_SECRET_NAME,
  customerId: "cust-internal-id",
  addressId: "address-internal-id",
  customer: { userId: CUSTOMER_USER, user: { email: M139_SECRET_EMAIL, phone: M139_SECRET_PHONE } },
  address: { line1: M139_SECRET_ADDRESS, postalCode: M139_SECRET_POSTAL_CODE, latitude: 40.1, longitude: -3.1 },
  latitude: 40.4168,
  longitude: -3.7038,
  customerUserId: CUSTOMER_USER,
  passwordHash: "hash",
};

describe("M139 — DTO mappers are explicit whitelists", () => {
  it("feed item DTO drops every over-fetched contact field and keeps the exact M134 key set", () => {
    const dto = toLeadFeedItemDto({
      ...OVERFETCH,
      leadId: LEAD,
      title: "Fuga",
      description: "desc",
      categoryId: CATEGORY,
      categoryName: "Fontanería",
      urgency: "HIGH",
      city: "Madrid",
      province: "Madrid",
      distanceKm: 1.2,
      publication: PUBLICATION,
    } as never);
    expect(() => assertNoContactLeak(dto)).not.toThrow();
    expect(Object.keys(dto).sort()).toEqual(
      ["buyerPolicy", "categoryId", "categoryName", "city", "currency", "description", "distanceKm", "leadId", "price", "province", "publishedAt", "title", "urgency"],
    );
  });

  it("preview DTO drops every over-fetched contact field and keeps the exact key set", () => {
    const dto = toLeadPreviewDto({
      ...OVERFETCH,
      leadId: LEAD,
      title: "Fuga",
      description: "d",
      categoryId: CATEGORY,
      categoryName: "Fontanería",
      urgency: "HIGH",
      city: "Madrid",
      province: null,
      createdAt: PUBLISHED_AT,
    } as never);
    expect(() => assertNoContactLeak(dto)).not.toThrow();
    expect(Object.keys(dto).sort()).toEqual(["categoryId", "categoryName", "city", "createdAt", "description", "distanceKm", "leadId", "province", "title", "urgency"]);
  });

  it.each(LEAD_PURCHASE_STATUSES)("purchase DTO (%s) never carries contact, customer or professional identity", (status) => {
    const record = { ...pendingPurchaseFromPublication("p-1", LEAD, PRO_A, PUBLICATION), status, ...OVERFETCH } as LeadPurchaseRecord;
    const dto = toLeadPurchaseDto(record);
    expect(() => assertNoContactLeak(dto)).not.toThrow();
    expect(collectKeys(dto).has("professionalProfileId")).toBe(false);
    expect(Object.keys(dto).sort()).toEqual(
      ["cancelledAt", "confirmedAt", "createdAt", "currency", "failedAt", "leadId", "price", "purchaseId", "status", "taxAmount", "taxPolicyVersion", "totalAmount"],
    );
  });
});

describe("M139 — contact policy across every purchase state", () => {
  const facts = (patch: Partial<LeadContactAuthorizationFacts> = {}): LeadContactAuthorizationFacts => ({
    leadExists: true,
    flowVersion: "LEAD_V1",
    grant: { state: "CONFIRMED", professionalProfileId: PRO_A },
    blocked: false,
    contactOwnershipConsistent: true,
    ...patch,
  });

  it("only CONFIRMED maps to a granting state; every other persisted status is denied", () => {
    for (const status of LEAD_PURCHASE_STATUSES) {
      const decision = canProfessionalAccessLeadContact(facts({ grant: { state: toLeadContactGrantState(status), professionalProfileId: PRO_A } }), PRO_A);
      expect(decision.allowed, status).toBe(status === "CONFIRMED");
    }
  });

  it("missing purchase, another professional's grant, wrong flow, blocked and inconsistent ownership all deny", () => {
    expect(canProfessionalAccessLeadContact(facts({ grant: null }), PRO_A).allowed).toBe(false);
    expect(canProfessionalAccessLeadContact(facts(), PRO_B).allowed).toBe(false);
    expect(canProfessionalAccessLeadContact(facts({ flowVersion: "LEGACY_QUOTE_PAYMENT" }), PRO_A).allowed).toBe(false);
    expect(canProfessionalAccessLeadContact(facts({ blocked: true }), PRO_A).allowed).toBe(false);
    expect(canProfessionalAccessLeadContact(facts({ contactOwnershipConsistent: false }), PRO_A).allowed).toBe(false);
    expect(canProfessionalAccessLeadContact(null, PRO_A).allowed).toBe(false);
  });

  it("an unrecognised grant state denies (fail closed)", () => {
    expect(canProfessionalAccessLeadContact(facts({ grant: { state: "UNLOCKED" as never, professionalProfileId: PRO_A } }), PRO_A).allowed).toBe(false);
  });

  it("the denial error is identical for every reason and carries no ids, reasons or other-professional hints", () => {
    const error = new LeadContactAccessDeniedError();
    expect(error.message).toBe("You do not have access to this contact information.");
    expect(error.message).not.toMatch(/professional|purchase|owner|customer|unlock|another/i);
    expect(error.message).not.toContain(LEAD);
  });

  it("non-CONFIRMED statuses never become CONFIRMED again via the state machine (no stale re-grant)", () => {
    for (const from of ["FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as const) {
      expect(() => assertLeadPurchaseTransition(from, "CONFIRMED"), from).toThrow();
    }
    expect(isActiveLeadPurchaseStatus("PENDING_PAYMENT")).toBe(true);
  });
});

describe("M139 — feed use case output is contact-safe even when the repository over-fetches", () => {
  const candidate = (): LeadFeedCandidate =>
    ({
      ...OVERFETCH,
      leadId: LEAD,
      position: { publishedAt: PUBLISHED_AT, leadId: LEAD },
      leadStatus: "PUBLISHED",
      flowVersion: "LEAD_V1",
      requestStatus: "PUBLISHED",
      requestDeleted: false,
      publication: PUBLICATION,
      title: "Fuga",
      description: "Fuga en el baño",
      categoryId: CATEGORY,
      categoryName: "Fontanería",
      urgency: "HIGH",
      city: "Madrid",
      province: "Madrid",
      latitude: 40.4168,
      longitude: -3.7038,
      customerUserId: CUSTOMER_USER,
    }) as unknown as LeadFeedCandidate;

  it("returns only whitelisted fields", async () => {
    const useCase = new GetLeadFeedForProfessionalUseCase(
      { findByUserId: async () => ({ id: PRO_A }) } as never,
      { findCandidateById: async () => ({ id: PRO_A, categoryIds: [CATEGORY], latitude: 40.4168, longitude: -3.7038, serviceRadiusKm: 50 }) } as never,
      { findPage: async () => [candidate()] },
    );
    const page = await useCase.execute("pro-user");
    expect(page.items).toHaveLength(1);
    expect(() => assertNoContactLeak(page)).not.toThrow();
    expect(JSON.stringify(page)).not.toContain(CUSTOMER_USER);
  });
});

describe("M139 — purchase initiation / confirmation / lifecycle responses are contact-safe", () => {
  const lead: LeadRecord = {
    id: LEAD,
    serviceRequestId: REQUEST,
    status: "PUBLISHED",
    flowVersion: "LEAD_V1",
    maxBuyers: null,
    publication: PUBLICATION,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const request = { ...OVERFETCH, id: REQUEST, status: "PUBLISHED", title: "Fuga", description: "Fuga en el baño", location: { city: "Madrid" } };
  const preview = {
    leadId: LEAD, title: "Fuga", description: "d", categoryId: CATEGORY, categoryName: "Fontanería", urgency: "HIGH", city: "Madrid", province: "Madrid",
    latitude: 40.4168, longitude: -3.7038, customerUserId: CUSTOMER_USER, createdAt: PUBLISHED_AT,
  } as LeadPreviewCandidate;

  /** Minimal in-memory repo; rows deliberately carry over-fetched sentinels to prove the DTO boundary. */
  function makeRepo() {
    const rows: LeadPurchaseRecord[] = [];
    const repo: LeadPurchaseRepository = {
      create: async () => {
        throw new Error("unused");
      },
      initiate: async (d: InitiateLeadPurchaseData) => {
        const row = { ...pendingPurchaseFromPublication(`p-${rows.length + 1}`, d.leadId, d.professionalProfileId, PUBLICATION), ...OVERFETCH } as LeadPurchaseRecord;
        rows.push(row);
        return { ...row };
      },
      transition: async (id: string, from: LeadPurchaseStatus, to: LeadPurchaseStatus, now: Date) => {
        const row = rows.find((r) => r.id === id && r.status === from);
        if (!row) return null;
        row.status = to;
        if (to === "CONFIRMED") row.confirmedAt = now;
        return { ...row };
      },
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      findActiveByLeadAndProfessional: async (leadId: string, pro: string) =>
        rows.find((r) => r.leadId === leadId && r.professionalProfileId === pro && isActiveLeadPurchaseStatus(r.status)) ?? null,
      findConfirmedByLeadAndProfessional: async () => null,
    } as LeadPurchaseRepository;
    return { rows, repo };
  }

  const candidatePro = { id: PRO_A, categoryIds: [CATEGORY], latitude: 40.4168, longitude: -3.7038, serviceRadiusKm: 50 };

  it("initiation (first call and idempotent replay) and confirmation return no contact data", async () => {
    const { repo } = makeRepo();
    const initiate = new InitiateLeadPurchaseUseCase(
      { findByUserId: async () => ({ id: PRO_A, status: "ACTIVE", verificationStatus: "VERIFIED" }) } as never,
      { findCandidateById: async () => candidatePro } as never,
      { findById: async () => lead } as never,
      { findById: async () => request } as never,
      { findPublishedById: async () => preview } as never,
      repo,
    );
    const first = await initiate.execute("pro-user", LEAD);
    const replay = await initiate.execute("pro-user", LEAD);
    expect(replay.purchaseId).toBe(first.purchaseId);
    for (const dto of [first, replay]) {
      expect(() => assertNoContactLeak(dto)).not.toThrow();
      expect(dto.status).toBe("PENDING_PAYMENT");
    }

    const confirmed = await new ConfirmLeadPurchaseUseCase(repo, { findById: async () => lead } as never, { findById: async () => request } as never).execute(first.purchaseId);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(() => assertNoContactLeak(confirmed)).not.toThrow();

    const refunded = await new TransitionLeadPurchaseUseCase(repo).execute(first.purchaseId, "REFUNDED");
    expect(refunded.status).toBe("REFUNDED");
    expect(() => assertNoContactLeak(refunded)).not.toThrow();
  });

  it("initiation ignores caller-controlled identity: the only inputs are the session user id and the lead id", () => {
    expect(InitiateLeadPurchaseUseCase.prototype.execute.length).toBe(2);
    expect(ConfirmLeadPurchaseUseCase.prototype.execute.length).toBe(1);
  });

  it("every 'may not buy' outcome is the same generic error (no contact, no other-buyer information)", async () => {
    const { repo } = makeRepo();
    const mk = (over: Record<string, unknown>) =>
      new InitiateLeadPurchaseUseCase(
        { findByUserId: async () => ({ id: PRO_A, status: "ACTIVE", verificationStatus: "VERIFIED" }) } as never,
        { findCandidateById: async () => candidatePro } as never,
        { findById: async () => ({ ...lead, ...over }) } as never,
        { findById: async () => request } as never,
        { findPublishedById: async () => preview } as never,
        repo,
      );
    const messages = new Set<string>();
    for (const over of [{ status: "CLOSED" }, { flowVersion: "LEGACY_QUOTE_PAYMENT" }]) {
      const error = await mk(over).execute("pro-user", LEAD).then(() => null, (e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      messages.add(error!.message);
    }
    expect([...messages]).toEqual(["This lead is not available for purchase."]);
  });
});

vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
