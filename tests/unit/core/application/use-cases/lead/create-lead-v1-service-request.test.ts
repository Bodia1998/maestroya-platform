import { describe, expect, it, vi } from "vitest";

import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { LeadPreviewCandidate, LeadPreviewRepository } from "@/domain/repositories/lead-preview-repository";
import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { CreateServiceRequestData, ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import { LeadAlreadyExistsError, LeadNotPublishableError } from "@/domain/services/lead";
import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";
import { createServiceRequestSchema } from "@/application/dto/service-request.dto";
import { PRIVATE_CONTACT_FIELD_NAMES } from "@/application/dto/lead-contact.dto";
import { CreateLeadUseCase } from "@/application/use-cases/lead/create-lead.use-case";
import { CreateLeadV1ServiceRequestUseCase } from "@/application/use-cases/lead/create-lead-v1-service-request.use-case";
import { GetPublishedLeadPreviewsForProfessionalUseCase } from "@/application/use-cases/lead/get-published-lead-previews.use-case";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";
import { TEST_BUYER_POLICY, fixedPriceSource, pricedOutcome, withSnapshot } from "../../../../../test-utils/lead-publication-fixtures";

const CAT = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-03T10:00:00Z");
const validInput = createServiceRequestSchema.parse({
  categoryId: CAT,
  title: "Fuga",
  description: "Fuga en el baño",
  location: { line1: "Calle Secreta 1", city: "Madrid", province: "Madrid", postalCode: "28001", country: "ES" },
});

/** One in-memory world shared by every fake, mimicking the DB semantics that matter. */
function world() {
  const customers = new Map<string, { id: string; userId: string }>();
  const requests = new Map<string, ServiceRequestRecord & { flowVersion: TransactionFlowVersion; ownerUserId: string }>();
  const leads = new Map<string, LeadRecord>();
  let seq = 0;

  const customerRepo = {
    findByUserId: vi.fn(async (u: string) => (customers.has(u) ? { ...customers.get(u)!, customerType: "INDIVIDUAL" as const } : null)),
    findById: vi.fn(),
    findOrCreateByUserId: vi.fn(async (u: string) => {
      if (!customers.has(u)) customers.set(u, { id: `cust-${u}`, userId: u });
      return { ...customers.get(u)!, customerType: "INDIVIDUAL" as const };
    }),
  };

  const requestRepo = {
    create: vi.fn(async (customerId: string, userId: string, data: CreateServiceRequestData) => {
      const rec = {
        id: `sr-${++seq}`, customerId, categoryId: data.categoryId, categoryName: "Fontanería", title: data.title, description: data.description,
        status: "PUBLISHED" as const, urgency: data.urgency, budgetMin: data.budgetMin, budgetMax: data.budgetMax, location: data.location, photos: [],
        createdAt: now, updatedAt: now, flowVersion: data.flowVersion ?? ("LEGACY_QUOTE_PAYMENT" as TransactionFlowVersion), ownerUserId: userId,
      };
      requests.set(rec.id, rec);
      return rec;
    }),
    findById: vi.fn(async (id: string) => requests.get(id) ?? null),
    updateStatus: vi.fn(async (id: string, status: ServiceRequestRecord["status"]) => { requests.get(id)!.status = status; }),
  };

  const flows = { findFlowVersion: vi.fn(async (id: string) => requests.get(id)?.flowVersion ?? null) };

  const leadRepo: LeadRepository = {
    create: vi.fn(async (d) => {
      if ([...leads.values()].some((l) => l.serviceRequestId === d.serviceRequestId)) throw new LeadAlreadyExistsError(d.serviceRequestId);
      const l: LeadRecord = { id: `lead-${++seq}`, serviceRequestId: d.serviceRequestId, status: "DRAFT", flowVersion: requests.get(d.serviceRequestId)!.flowVersion, maxBuyers: null, createdAt: now, updatedAt: now };
      leads.set(l.id, l);
      return l;
    }),
    publish: vi.fn(async (id, snapshot) => {
      const l = leads.get(id);
      if (!l || l.status !== "DRAFT") return null;
      const next = withSnapshot(l, snapshot);
      leads.set(id, next);
      return next;
    }),
    findById: vi.fn(async (id) => leads.get(id) ?? null),
    findByServiceRequestId: vi.fn(async (sr) => [...leads.values()].find((l) => l.serviceRequestId === sr) ?? null),
  };

  const previews: LeadPreviewRepository = {
    findPublishedById: vi.fn(async () => null),
    findPublishedByCategoryIds: vi.fn(async (ids: string[]) =>
      [...leads.values()]
        .filter((l) => l.status === "PUBLISHED")
        .map((l) => ({ l, r: requests.get(l.serviceRequestId)! }))
        .filter(({ r }) => r.flowVersion === "LEAD_V1" && r.status === "PUBLISHED" && ids.includes(r.categoryId))
        .map(({ l, r }): LeadPreviewCandidate => ({
          leadId: l.id, title: r.title, description: r.description, categoryId: r.categoryId, categoryName: r.categoryName, urgency: r.urgency,
          city: r.location.city, province: r.location.province, latitude: 40.4168, longitude: -3.7038, customerUserId: r.ownerUserId, createdAt: l.createdAt,
        })),
    ),
  };

  const categories = { findActiveByIds: vi.fn(async (ids: string[]) => ids.filter((i) => i === CAT).map((id) => ({ id }))) };
  const geocoding = { geocode: vi.fn(async () => null) };
  const createLead = new CreateLeadUseCase(customerRepo as never, requestRepo as never, flows, leadRepo);
  const entry = new CreateLeadV1ServiceRequestUseCase(requestRepo as never, customerRepo as never, categories as never, geocoding as never, createLead);
  const publish = new PublishLeadUseCase(customerRepo as never, requestRepo as never, leadRepo, fixedPriceSource(pricedOutcome()), TEST_BUYER_POLICY);
  const professionals = { findByUserId: vi.fn(async (u: string) => (u === "pro" ? { id: "pro-1" } : null)) };
  const discovery = { findCandidateById: vi.fn(async () => ({ id: "pro-1", categoryIds: [CAT], latitude: 40.42, longitude: -3.7, serviceRadiusKm: 50 })) };
  const feed = new GetPublishedLeadPreviewsForProfessionalUseCase(professionals as never, discovery as never, previews);
  return { requests, leads, requestRepo, leadRepo, createLead, entry, publish, feed, customerRepo };
}

describe("CreateLeadV1ServiceRequestUseCase", () => {
  it("persists flowVersion LEAD_V1 explicitly and owns the request by the session user", async () => {
    const w = world();
    const { serviceRequest, lead } = await w.entry.execute("user-a", validInput);
    expect(w.requestRepo.create.mock.calls[0]![2].flowVersion).toBe("LEAD_V1");
    expect(w.requests.get(serviceRequest.id)!.flowVersion).toBe("LEAD_V1");
    expect(serviceRequest.customerId).toBe("cust-user-a");
    expect(w.requestRepo.create.mock.calls[0]![0]).toBe("cust-user-a");
    expect(w.requestRepo.create.mock.calls[0]![1]).toBe("user-a");
    expect(lead).toMatchObject({ status: "DRAFT", serviceRequestId: serviceRequest.id, flowVersion: "LEAD_V1" });
  });

  it("creates the Lead only through the Module 124 use case and does not publish", async () => {
    const w = world();
    const spy = vi.spyOn(w.createLead, "execute");
    const { serviceRequest } = await w.entry.execute("user-a", validInput);
    expect(spy).toHaveBeenCalledWith("user-a", serviceRequest.id);
    expect(w.leadRepo.publish).not.toHaveBeenCalled();
    expect(w.leads.size).toBe(1);
  });

  it("ignores client-supplied owner / flow fields (schema strips them, use case never reads them)", async () => {
    const w = world();
    const parsed = createServiceRequestSchema.parse({
      ...validInput, flowVersion: "LEGACY_QUOTE_PAYMENT", customerId: "cust-victim", userId: "victim", ownerId: "victim",
    });
    expect(parsed).not.toHaveProperty("flowVersion");
    expect(parsed).not.toHaveProperty("customerId");
    // Even if the unparsed object reaches the use case, only named fields are used.
    const hostile = { ...parsed, flowVersion: "LEGACY_QUOTE_PAYMENT", customerId: "cust-victim", userId: "victim" } as never;
    const { serviceRequest } = await w.entry.execute("user-a", hostile);
    expect(w.requests.get(serviceRequest.id)).toMatchObject({ flowVersion: "LEAD_V1", customerId: "cust-user-a", ownerUserId: "user-a" });
  });

  it("rejects invalid input before persisting anything", async () => {
    const w = world();
    expect(createServiceRequestSchema.safeParse({ ...validInput, title: "" }).success).toBe(false);
    expect(createServiceRequestSchema.safeParse({ ...validInput, categoryId: "nope" }).success).toBe(false);
    await expect(w.entry.execute("user-a", { ...validInput, categoryId: "22222222-2222-4222-8222-222222222222" })).rejects.toBeInstanceOf(ValidationError);
    await expect(w.entry.execute("user-a", { ...validInput, budgetMin: 10, budgetMax: 5 })).rejects.toBeInstanceOf(ValidationError);
    expect(w.requestRepo.create).not.toHaveBeenCalled();
    expect(w.leadRepo.create).not.toHaveBeenCalled();
  });

  it("compensates (cancels the request) and rethrows when Lead creation fails — no open request without a Lead", async () => {
    const w = world();
    (w.leadRepo.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    await expect(w.entry.execute("user-a", validInput)).rejects.toThrow("db down");
    const [req] = [...w.requests.values()];
    expect(req!.status).toBe("CANCELLED");
    expect(w.leads.size).toBe(0);
  });

  it("is financially inert: only ServiceRequest + Lead writes happen", async () => {
    const w = world();
    await w.entry.execute("user-a", validInput);
    expect(w.requests.size).toBe(1);
    expect(w.leads.size).toBe(1);
  });

  it("repeating the creation makes a separate request, never a second Lead for one request", async () => {
    const w = world();
    const a = await w.entry.execute("user-a", validInput);
    const b = await w.entry.execute("user-a", validInput);
    expect(a.serviceRequest.id).not.toBe(b.serviceRequest.id);
    await expect(w.createLead.execute("user-a", a.serviceRequest.id)).rejects.toBeInstanceOf(LeadAlreadyExistsError);
    expect(w.leads.size).toBe(2);
  });
});

describe("Lead V1 end-to-end (create -> publish -> professional preview)", () => {
  it("customer cannot create a Lead from, or publish, another customer's request/Lead", async () => {
    const w = world();
    const a = await w.entry.execute("user-a", validInput);
    await w.customerRepo.findOrCreateByUserId("user-b");
    await expect(w.createLead.execute("user-b", a.serviceRequest.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.publish.execute("user-b", a.lead.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.publish.execute("user-without-profile", a.lead.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(w.leads.get(a.lead.id)!.status).toBe("DRAFT");
  });

  it("DRAFT is invisible; publish makes it visible; repeated publish is safe; preview is contact-safe", async () => {
    const w = world();
    const a = await w.entry.execute("user-a", validInput);
    expect(await w.feed.execute("pro")).toEqual([]);
    expect((await w.publish.execute("user-a", a.lead.id)).status).toBe("PUBLISHED");
    expect((await w.publish.execute("user-a", a.lead.id)).status).toBe("PUBLISHED");
    expect(w.leadRepo.publish).toHaveBeenCalledTimes(1);

    const list = await w.feed.execute("pro");
    expect(list).toHaveLength(1);
    const json = JSON.stringify(list);
    for (const forbidden of [...PRIVATE_CONTACT_FIELD_NAMES, "latitude", "longitude", "customerUserId", "user-a", "Calle Secreta", "28001", "serviceRequestId", "purchase"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(await w.feed.execute("user-a")).toEqual([]); // plain customer
  });

  it("a legacy request never appears in the Lead preview and cannot get a Lead", async () => {
    const w = world();
    const legacy = await w.requestRepo.create("cust-user-a", "user-a", { ...validInput, urgency: "MEDIUM", budgetMin: null, budgetMax: null, line2: null } as never);
    await w.customerRepo.findOrCreateByUserId("user-a");
    expect(legacy.flowVersion).toBe("LEGACY_QUOTE_PAYMENT");
    await expect(w.createLead.execute("user-a", legacy.id)).rejects.toThrow();
    expect(await w.feed.execute("pro")).toEqual([]);
  });

  for (const status of ["CLOSED", "EXPIRED", "CANCELLED"] as const) {
    it(`a ${status} Lead cannot be published`, async () => {
      const w = world();
      const a = await w.entry.execute("user-a", validInput);
      w.leads.set(a.lead.id, { ...a.lead, status });
      await expect(w.publish.execute("user-a", a.lead.id)).rejects.toBeInstanceOf(LeadNotPublishableError);
    });
  }
});
