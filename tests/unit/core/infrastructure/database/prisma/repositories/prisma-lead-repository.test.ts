import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/domain/errors/domain-error";
import { InvalidLeadFlowError, InvalidLeadMaxBuyersError, LeadAlreadyExistsError } from "@/domain/services/lead";

/**
 * Module 123 — PrismaLeadRepository against a mocked Prisma client. Every
 * model other than serviceRequest/lead is a tripwire: touching quote /
 * payment / commission / payout / invoice here fails the test.
 */
const now = new Date("2026-10-02T10:00:00.000Z");
const serviceRequest = { findUnique: vi.fn() };
const lead = { create: vi.fn(), findUnique: vi.fn() };
const tx = { serviceRequest, lead };

function forbidden(name: string) {
  return new Proxy({}, { get: () => () => { throw new Error(`${name} must not be touched by the lead repository`); } });
}

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    serviceRequest,
    lead,
    quote: forbidden("quote"),
    payment: forbidden("payment"),
    commission: forbidden("commission"),
    payout: forbidden("payout"),
    invoice: forbidden("invoice"),
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));

const row = (flowVersion = "LEAD_V1") => ({
  id: "lead-1",
  serviceRequestId: "sr-1",
  status: "DRAFT",
  maxBuyers: null,
  // Module 133: a never-published lead has every publication column NULL.
  publishedAt: null,
  publicationPrice: null,
  publicationCurrency: null,
  publicationEstimatedJobValue: null,
  publicationPricingRate: null,
  publicationPricingConfidence: null,
  publicationPricingConfigVersion: null,
  publicationJobValueRuleVersion: null,
  publicationPricingRuleVersion: null,
  publicationBuyerPolicyVersion: null,
  createdAt: now,
  updatedAt: now,
  serviceRequest: { flowVersion },
});

async function repo() {
  const { PrismaLeadRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-repository");
  return new PrismaLeadRepository();
}

describe("PrismaLeadRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a DRAFT lead for a LEAD_V1 request and returns the derived flowVersion", async () => {
    serviceRequest.findUnique.mockResolvedValue({ flowVersion: "LEAD_V1", deletedAt: null });
    lead.create.mockResolvedValue(row());
    const result = await (await repo()).create({ serviceRequestId: "sr-1" });
    expect(lead.create).toHaveBeenCalledWith(expect.objectContaining({ data: { serviceRequestId: "sr-1", maxBuyers: null } }));
    expect(result).toEqual({
      id: "lead-1",
      serviceRequestId: "sr-1",
      status: "DRAFT",
      flowVersion: "LEAD_V1",
      maxBuyers: null,
      publication: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("never stores flowVersion on the lead row (derived, single source of truth)", async () => {
    serviceRequest.findUnique.mockResolvedValue({ flowVersion: "LEAD_V1", deletedAt: null });
    lead.create.mockResolvedValue(row());
    await (await repo()).create({ serviceRequestId: "sr-1", maxBuyers: 2 });
    const data = lead.create.mock.calls[0]![0]!.data;
    expect(data).toEqual({ serviceRequestId: "sr-1", maxBuyers: 2 });
    expect(data).not.toHaveProperty("flowVersion");
  });

  it("rejects a LEGACY_QUOTE_PAYMENT ServiceRequest and writes nothing", async () => {
    serviceRequest.findUnique.mockResolvedValue({ flowVersion: "LEGACY_QUOTE_PAYMENT", deletedAt: null });
    await expect((await repo()).create({ serviceRequestId: "sr-legacy" })).rejects.toBeInstanceOf(InvalidLeadFlowError);
    expect(lead.create).not.toHaveBeenCalled();
  });

  it("requires an existing, non-deleted ServiceRequest", async () => {
    serviceRequest.findUnique.mockResolvedValue(null);
    await expect((await repo()).create({ serviceRequestId: "missing" })).rejects.toBeInstanceOf(NotFoundError);
    serviceRequest.findUnique.mockResolvedValue({ flowVersion: "LEAD_V1", deletedAt: now });
    await expect((await repo()).create({ serviceRequestId: "gone" })).rejects.toBeInstanceOf(NotFoundError);
    expect(lead.create).not.toHaveBeenCalled();
  });

  it("maps the unique violation (one Lead per ServiceRequest) to LeadAlreadyExistsError", async () => {
    serviceRequest.findUnique.mockResolvedValue({ flowVersion: "LEAD_V1", deletedAt: null });
    lead.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
    await expect((await repo()).create({ serviceRequestId: "sr-1" })).rejects.toBeInstanceOf(LeadAlreadyExistsError);
  });

  it("rethrows unrelated database errors untouched", async () => {
    serviceRequest.findUnique.mockResolvedValue({ flowVersion: "LEAD_V1", deletedAt: null });
    const boom = new Error("db down");
    lead.create.mockRejectedValue(boom);
    await expect((await repo()).create({ serviceRequestId: "sr-1" })).rejects.toBe(boom);
  });

  it("validates maxBuyers before touching the database", async () => {
    await expect((await repo()).create({ serviceRequestId: "sr-1", maxBuyers: 0 })).rejects.toBeInstanceOf(InvalidLeadMaxBuyersError);
    expect(serviceRequest.findUnique).not.toHaveBeenCalled();
  });

  it("finds by id and by serviceRequestId, and returns null when absent", async () => {
    lead.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    const r = await repo();
    expect((await r.findById("lead-1"))?.id).toBe("lead-1");
    expect((await r.findByServiceRequestId("sr-1"))?.serviceRequestId).toBe("sr-1");
    expect(await r.findById("nope")).toBeNull();
  });

  it("surfaces a non-LEAD_V1 derived flow as-is so Module 122 can deny WRONG_FLOW", async () => {
    lead.findUnique.mockResolvedValue(row("LEGACY_QUOTE_PAYMENT"));
    expect((await (await repo()).findById("lead-1"))?.flowVersion).toBe("LEGACY_QUOTE_PAYMENT");
  });

  it("never selects customer contact data (explicit select; only flowVersion from the request)", async () => {
    lead.findUnique.mockResolvedValue(row());
    await (await repo()).findById("lead-1");
    const select = lead.findUnique.mock.calls[0]![0]!.select;
    expect(select.serviceRequest).toEqual({ select: { flowVersion: true } });
    expect(JSON.stringify(select)).not.toMatch(/email|phone|address|line1|customer|title|description|name/i);
    const result = await (await repo()).findById("lead-1");
    expect(Object.keys(result!).sort()).toEqual(["createdAt", "flowVersion", "id", "maxBuyers", "publication", "serviceRequestId", "status", "updatedAt"]);
  });

  it("rejects a persisted unknown status instead of passing it through", async () => {
    lead.findUnique.mockResolvedValue({ ...row(), status: "BOGUS" });
    await expect((await repo()).findById("lead-1")).rejects.toThrow(/Unknown Lead status/);
  });
});
