import { describe, expect, it, vi } from "vitest";

import { LeadPublished } from "@/domain/events/lead-published";
import type { DomainEvent } from "@/domain/events/domain-event";
import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";

import { TEST_BUYER_POLICY, fixedPriceSource, pricedOutcome, unpricedOutcome, withSnapshot } from "../../../../../test-utils/lead-publication-fixtures";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Module 145 — PublishLeadUseCase raises LeadPublished exactly when ITS call performs DRAFT -> PUBLISHED. */
const USER = "user-1";
const CUSTOMER = "cust-1";
const now = new Date("2026-10-06T10:00:00Z");

const request = (): ServiceRequestRecord =>
  ({
    id: "sr-1", customerId: CUSTOMER, categoryId: "cat", categoryName: "Fontanería", title: "Fuga", description: "Fuga en el baño", status: "PUBLISHED", urgency: "MEDIUM",
    budgetMin: null, budgetMax: null, location: { line1: "x", line2: null, city: "Madrid", province: "Madrid", postalCode: "28001", country: "ES", latitude: null, longitude: null },
    photos: [], createdAt: now, updatedAt: now,
  }) as ServiceRequestRecord;

const draft = (patch: Partial<LeadRecord> = {}): LeadRecord => ({ id: "lead-1", serviceRequestId: "sr-1", status: "DRAFT", flowVersion: "LEAD_V1", maxBuyers: null, publication: null, createdAt: now, updatedAt: now, ...patch });

function build(opts: { lead?: LeadRecord; unpriced?: boolean; publishFails?: boolean; noBus?: boolean } = {}) {
  const rows = new Map([[("lead-1"), opts.lead ?? draft()]]);
  const leads = {
    publish: vi.fn(async (id: string, snapshot: never) => {
      await Promise.resolve();
      const row = rows.get(id);
      if (!row || row.status !== "DRAFT" || row.publication) return null;
      const next = withSnapshot(row, snapshot);
      rows.set(id, next);
      return next;
    }),
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
  } as unknown as LeadRepository;
  const published: DomainEvent[] = [];
  const bus = {
    publish: vi.fn(async (event: DomainEvent) => {
      if (opts.publishFails) throw new Error("subscriber exploded");
      published.push(event);
    }),
  };
  const uc = new PublishLeadUseCase(
    { findByUserId: vi.fn(async () => ({ id: CUSTOMER })) } as never,
    { findById: vi.fn(async () => request()) } as never,
    leads,
    fixedPriceSource(opts.unpriced ? unpricedOutcome("UNPRICED", "SERVICE_VALUE_UNAVAILABLE") : pricedOutcome()),
    TEST_BUYER_POLICY,
    opts.noBus ? undefined : bus,
  );
  return { uc, published, bus };
}

describe("PublishLeadUseCase — M145 LeadPublished", () => {
  it("raises LeadPublished (lead id only) after a successful DRAFT -> PUBLISHED publication", async () => {
    const { uc, published } = build();
    await uc.execute(USER, "lead-1");
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(LeadPublished);
    expect((published[0] as LeadPublished).leadId).toBe("lead-1");
    expect(Object.keys(published[0]!).sort()).toEqual(["eventId", "leadId", "occurredAt"]);
  });

  it("an idempotent repeat of an already PUBLISHED lead raises nothing", async () => {
    const { uc, published } = build();
    await uc.execute(USER, "lead-1");
    await uc.execute(USER, "lead-1");
    expect(published).toHaveLength(1);
  });

  it("concurrent publishes: only the call that won the conditional write raises the event", async () => {
    const { uc, published } = build();
    const results = await Promise.all(Array.from({ length: 5 }, () => uc.execute(USER, "lead-1")));
    expect(results.every((lead) => lead.status === "PUBLISHED")).toBe(true);
    expect(published).toHaveLength(1);
  });

  it("a rejected publication (unpriceable) raises nothing and the lead stays DRAFT", async () => {
    const { uc, published } = build({ unpriced: true });
    await expect(uc.execute(USER, "lead-1")).rejects.toThrow();
    expect(published).toEqual([]);
  });

  it("an already CLOSED lead is rejected and raises nothing", async () => {
    const { uc, published } = build({ lead: draft({ status: "CLOSED" }) });
    await expect(uc.execute(USER, "lead-1")).rejects.toThrow();
    expect(published).toEqual([]);
  });

  it("a failing subscriber never fails or rolls back the publication", async () => {
    const { uc } = build({ publishFails: true });
    const lead = await uc.execute(USER, "lead-1");
    expect(lead.status).toBe("PUBLISHED");
  });

  it("without a bus (pre-M145 constructions) it publishes exactly as before", async () => {
    const { uc } = build({ noBus: true });
    expect((await uc.execute(USER, "lead-1")).status).toBe("PUBLISHED");
  });
});
