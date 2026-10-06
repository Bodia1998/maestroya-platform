import { describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/domain/errors/domain-error";
import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import {
  InvalidLeadFlowError,
  LeadAlreadyExistsError,
  LeadNotPublishableError,
  ServiceRequestNotEligibleForLeadError,
} from "@/domain/services/lead";
import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";
import { CreateLeadUseCase } from "@/application/use-cases/lead/create-lead.use-case";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";
import { TEST_BUYER_POLICY, fixedPriceSource, pricedOutcome, withSnapshot } from "../../../../../test-utils/lead-publication-fixtures";

const USER = "user-1";
const CUSTOMER = "cust-1";
const SR = "sr-1";
const now = new Date("2026-10-03T10:00:00Z");

function request(patch: Partial<ServiceRequestRecord> = {}): ServiceRequestRecord {
  return {
    id: SR,
    customerId: CUSTOMER,
    categoryId: "cat",
    categoryName: "Fontanería",
    title: "Fuga",
    description: "Fuga en el baño",
    status: "PUBLISHED",
    urgency: "MEDIUM",
    budgetMin: null,
    budgetMax: null,
    location: { line1: "Calle X 1", line2: null, city: "Madrid", province: "Madrid", postalCode: "28001", country: "ES", latitude: null, longitude: null },
    photos: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function lead(patch: Partial<LeadRecord> = {}): LeadRecord {
  return { id: "lead-1", serviceRequestId: SR, status: "DRAFT", flowVersion: "LEAD_V1", maxBuyers: null, createdAt: now, updatedAt: now, ...patch };
}

/** In-memory LeadRepository mimicking the unique constraint + conditional publish. */
function fakeLeads(initial: LeadRecord[] = []) {
  const rows = new Map(initial.map((l) => [l.id, l]));
  const repo: LeadRepository & { rows: Map<string, LeadRecord> } = {
    rows,
    create: vi.fn(async (data) => {
      if ([...rows.values()].some((l) => l.serviceRequestId === data.serviceRequestId)) throw new LeadAlreadyExistsError(data.serviceRequestId);
      const created = lead({ id: `lead-${rows.size + 1}`, serviceRequestId: data.serviceRequestId, maxBuyers: data.maxBuyers ?? null });
      rows.set(created.id, created);
      return created;
    }),
    publish: vi.fn(async (id, snapshot) => {
      const row = rows.get(id);
      if (!row || row.status !== "DRAFT") return null;
      const next = withSnapshot(row, snapshot);
      rows.set(id, next);
      return next;
    }),
    findById: vi.fn(async (id) => rows.get(id) ?? null),
    findByServiceRequestId: vi.fn(async (sr) => [...rows.values()].find((l) => l.serviceRequestId === sr) ?? null),
  };
  return repo;
}

const customers = (found = true) => ({
  findByUserId: vi.fn(async () => (found ? { id: CUSTOMER, userId: USER, customerType: "INDIVIDUAL" as const } : null)),
});
const requests = (r: ServiceRequestRecord | null) => ({ findById: vi.fn(async () => r) });
const flows = (f: TransactionFlowVersion | null) => ({ findFlowVersion: vi.fn(async () => f) });

function createUc(opts: { req?: ServiceRequestRecord | null; flow?: TransactionFlowVersion | null; leads?: LeadRecord[]; customer?: boolean } = {}) {
  const leads = fakeLeads(opts.leads);
  const sr = requests(opts.req === undefined ? request() : opts.req);
  const uc = new CreateLeadUseCase(customers(opts.customer ?? true) as never, sr as never, flows(opts.flow === undefined ? "LEAD_V1" : opts.flow), leads);
  return { uc, leads };
}

describe("CreateLeadUseCase", () => {
  it("creates a DRAFT lead with maxBuyers unset for a valid LEAD_V1 request", async () => {
    const { uc, leads } = createUc();
    const result = await uc.execute(USER, SR);
    expect(result).toMatchObject({ status: "DRAFT", serviceRequestId: SR, flowVersion: "LEAD_V1", maxBuyers: null });
    expect(leads.create).toHaveBeenCalledWith({ serviceRequestId: SR });
    expect(leads.publish).not.toHaveBeenCalled();
  });

  it("rejects a LEGACY_QUOTE_PAYMENT request without touching the repository", async () => {
    const { uc, leads } = createUc({ flow: "LEGACY_QUOTE_PAYMENT" });
    await expect(uc.execute(USER, SR)).rejects.toBeInstanceOf(InvalidLeadFlowError);
    expect(leads.create).not.toHaveBeenCalled();
  });

  it("rejects a missing request, another customer's request and a user with no customer profile identically", async () => {
    for (const { uc } of [createUc({ req: null }), createUc({ req: request({ customerId: "other" }) }), createUc({ customer: false }), createUc({ flow: null })]) {
      await expect(uc.execute(USER, SR)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("rejects a request that is not open", async () => {
    const { uc, leads } = createUc({ req: request({ status: "CANCELLED" }) });
    await expect(uc.execute(USER, SR)).rejects.toBeInstanceOf(ServiceRequestNotEligibleForLeadError);
    expect(leads.create).not.toHaveBeenCalled();
  });

  it("prevents a duplicate lead and never silently creates a second one", async () => {
    const { uc, leads } = createUc({ leads: [lead()] });
    await expect(uc.execute(USER, SR)).rejects.toBeInstanceOf(LeadAlreadyExistsError);
    expect(leads.rows.size).toBe(1);
    expect(leads.create).not.toHaveBeenCalled();
  });

  it("a concurrent create losing the unique race surfaces LeadAlreadyExistsError", async () => {
    const { uc, leads } = createUc();
    (leads.findByServiceRequestId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await uc.execute(USER, SR);
    (leads.findByServiceRequestId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(uc.execute(USER, SR)).rejects.toBeInstanceOf(LeadAlreadyExistsError);
  });

  it("does not mutate the ServiceRequest flowVersion (read-only source of truth)", async () => {
    const f = flows("LEAD_V1");
    const uc = new CreateLeadUseCase(customers() as never, requests(request()) as never, f, fakeLeads());
    await uc.execute(USER, SR);
    expect(Object.keys(f)).toEqual(["findFlowVersion"]);
  });
});

function publishUc(opts: { lead?: LeadRecord | null; req?: ServiceRequestRecord | null; customer?: boolean } = {}) {
  const leads = fakeLeads(opts.lead === null ? [] : [opts.lead ?? lead()]);
  const uc = new PublishLeadUseCase(customers(opts.customer ?? true) as never, requests(opts.req === undefined ? request() : opts.req) as never, leads, fixedPriceSource(pricedOutcome()), TEST_BUYER_POLICY);
  return { uc, leads };
}

describe("PublishLeadUseCase", () => {
  it("publishes a DRAFT lead", async () => {
    const { uc, leads } = publishUc();
    const result = await uc.execute(USER, "lead-1");
    expect(result.status).toBe("PUBLISHED");
    expect(leads.publish).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for an already PUBLISHED lead (no write)", async () => {
    const { uc, leads } = publishUc({ lead: lead({ status: "PUBLISHED" }) });
    const result = await uc.execute(USER, "lead-1");
    expect(result.status).toBe("PUBLISHED");
    expect(leads.publish).not.toHaveBeenCalled();
    expect(leads.create).not.toHaveBeenCalled();
    expect(leads.rows.size).toBe(1);
  });

  it.each(["CLOSED", "EXPIRED", "CANCELLED"] as const)("rejects %s", async (status) => {
    const { uc, leads } = publishUc({ lead: lead({ status }) });
    await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(LeadNotPublishableError);
    expect(leads.publish).not.toHaveBeenCalled();
    expect(leads.rows.get("lead-1")!.status).toBe(status);
  });

  it("rejects a lead whose request is not LEAD_V1", async () => {
    const { uc, leads } = publishUc({ lead: lead({ flowVersion: "LEGACY_QUOTE_PAYMENT" }) });
    await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(InvalidLeadFlowError);
    expect(leads.publish).not.toHaveBeenCalled();
  });

  it("rejects when the underlying request is no longer open or is incomplete", async () => {
    for (const req of [request({ status: "CANCELLED" }), request({ description: " " })]) {
      const { uc } = publishUc({ req });
      await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(ServiceRequestNotEligibleForLeadError);
    }
  });

  it("missing lead, other customer's lead and no customer profile are the same NotFoundError", async () => {
    for (const { uc } of [publishUc({ lead: null }), publishUc({ req: request({ customerId: "other" }) }), publishUc({ customer: false }), publishUc({ req: null })]) {
      await expect(uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("a lost race resolving to PUBLISHED is idempotent; to another status is rejected", async () => {
    const a = publishUc();
    (a.leads.publish as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      a.leads.rows.set("lead-1", lead({ status: "PUBLISHED" }));
      return null;
    });
    expect((await a.uc.execute(USER, "lead-1")).status).toBe("PUBLISHED");

    const b = publishUc();
    (b.leads.publish as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      b.leads.rows.set("lead-1", lead({ status: "CANCELLED" }));
      return null;
    });
    await expect(b.uc.execute(USER, "lead-1")).rejects.toBeInstanceOf(LeadNotPublishableError);
  });
});
