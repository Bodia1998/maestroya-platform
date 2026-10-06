/**
 * Module 133 — Lead publication snapshot against REAL PostgreSQL: atomic
 * status + snapshot, first-writer-wins under concurrency, immutability, and the
 * database-level guarantees (CHECKs + trigger) behind the application rules.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";

import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createAddress, createCustomerProfile, createServiceCategory, createServiceRequest, createUser } from "../../test-utils/db/seed-helpers";

describe("Module 133 — lead publication snapshot (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const requests = new PrismaServiceRequestRepository();

  async function draftLead() {
    const user = await createUser(prisma, { name: "Customer" });
    const address = await createAddress(prisma, user.id);
    const customer = await createCustomerProfile(prisma, user.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    return { request, lead: await leads.create({ serviceRequestId: request.id }) };
  }

  it("publishes status, snapshot and buyer policy together, with exact decimals", async () => {
    const { lead } = await draftLead();
    const published = await leads.publish(lead.id, SNAPSHOT_DATA);
    expect(published).toMatchObject({ status: "PUBLISHED", maxBuyers: 2 });
    expect(published?.publication).toMatchObject({ ...SNAPSHOT_DATA });
    expect(published?.publication?.publishedAt).toBeInstanceOf(Date);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.publicationPrice?.toString()).toBe("18");
    expect(row.publicationPricingRate?.toString()).toBe("0.12");
  });

  it("concurrent publications: exactly one wins and the first snapshot stays", async () => {
    const { lead } = await draftLead();
    const results = await Promise.all(
      ["10.00", "20.00", "30.00", "40.00", "50.00", "60.00"].map((price) => leads.publish(lead.id, { ...SNAPSHOT_DATA, price })),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    const winner = results.find((r) => r !== null)!;
    const stored = await leads.findById(lead.id);
    expect(stored?.publication).toEqual(winner.publication);
  });

  it("a second publication never overwrites the snapshot or the buyer policy", async () => {
    const { lead } = await draftLead();
    await leads.publish(lead.id, SNAPSHOT_DATA);
    expect(await leads.publish(lead.id, { ...SNAPSHOT_DATA, price: "99.00", maxBuyers: 9, buyerPolicyVersion: "other" })).toBeNull();
    expect((await leads.findById(lead.id))?.publication).toMatchObject({ price: "18.00", maxBuyers: 2, buyerPolicyVersion: "lead-buyer-policy-test-v1" });
  });

  it("a terminal lead or a closed request cannot be published", async () => {
    const a = await draftLead();
    await requests.updateStatus(a.request.id, "CANCELLED");
    expect(await leads.publish(a.lead.id, SNAPSHOT_DATA)).toBeNull();
    expect((await leads.findById(a.lead.id))).toMatchObject({ status: "CANCELLED", publication: null });

    const b = await draftLead();
    await prisma.serviceRequest.update({ where: { id: b.request.id }, data: { deletedAt: new Date() } });
    expect(await leads.publish(b.lead.id, SNAPSHOT_DATA)).toBeNull();
    expect((await leads.findById(b.lead.id))?.status).toBe("DRAFT");
  });

  it("a legacy-flow request can never be published as a lead", async () => {
    const { request, lead } = await draftLead();
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEGACY_QUOTE_PAYMENT" } });
    expect(await leads.publish(lead.id, SNAPSHOT_DATA)).toBeNull();
  });

  it("the database refuses a PUBLISHED lead without a snapshot, a half-written snapshot, and any later change", async () => {
    const { lead } = await draftLead();
    await expect(prisma.lead.update({ where: { id: lead.id }, data: { status: "PUBLISHED" } })).rejects.toThrow();
    await expect(prisma.lead.update({ where: { id: lead.id }, data: { publicationPrice: "5.00" } })).rejects.toThrow();

    await leads.publish(lead.id, SNAPSHOT_DATA);
    await expect(prisma.lead.update({ where: { id: lead.id }, data: { publicationPrice: "99.00" } })).rejects.toThrow(/immutable/);
    await expect(prisma.lead.update({ where: { id: lead.id }, data: { maxBuyers: 7 } })).rejects.toThrow(/immutable/);
    // lifecycle propagation still works on a published lead
    await requests.updateStatus((await leads.findById(lead.id))!.serviceRequestId, "CANCELLED");
    expect((await leads.findById(lead.id))).toMatchObject({ status: "CANCELLED", publication: expect.objectContaining({ price: "18.00" }) });
  });
});
