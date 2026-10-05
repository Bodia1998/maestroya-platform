/**
 * Module 130 — ServiceRequest -> Lead propagation against REAL PostgreSQL.
 * Proves the transactional, idempotent, scoped behaviour and that existing
 * LeadPurchase rows survive untouched.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import {
  createAddress,
  createCustomerProfile,
  createProfessionalProfile,
  createServiceCategory,
  createServiceRequest,
  createUser,
} from "../../test-utils/db/seed-helpers";

describe("Module 130 — lead lifecycle propagation (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const requests = new PrismaServiceRequestRepository();
  const purchases = new PrismaLeadPurchaseRepository();

  async function makeLead(opts: { publish?: boolean; flow?: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT" } = {}) {
    const user = await createUser(prisma, { name: "Customer" });
    const address = await createAddress(prisma, user.id);
    const customer = await createCustomerProfile(prisma, user.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    let lead = await leads.create({ serviceRequestId: request.id });
    if (opts.publish ?? true) lead = (await leads.publish(lead.id))!;
    return { request, lead };
  }

  const statusOf = async (id: string) => (await prisma.lead.findUniqueOrThrow({ where: { id } })).status;

  it.each([
    ["CANCELLED", "CANCELLED"],
    ["EXPIRED", "EXPIRED"],
    ["COMPLETED", "CLOSED"],
  ] as const)("request %s makes the lead %s, and repeating is safe", async (requestStatus, leadStatus) => {
    const { request, lead } = await makeLead();
    await requests.updateStatus(request.id, requestStatus);
    expect(await statusOf(lead.id)).toBe(leadStatus);
    await requests.updateStatus(request.id, requestStatus);
    expect(await statusOf(lead.id)).toBe(leadStatus);
  });

  it("a DRAFT lead also becomes unavailable when its request is cancelled", async () => {
    const { request, lead } = await makeLead({ publish: false });
    await requests.updateStatus(request.id, "CANCELLED");
    expect(await statusOf(lead.id)).toBe("CANCELLED");
  });

  it("a terminal lead never changes again (first terminal state wins) and cannot be re-published", async () => {
    const { request, lead } = await makeLead();
    await requests.updateStatus(request.id, "CANCELLED");
    await requests.updateStatus(request.id, "EXPIRED");
    expect(await statusOf(lead.id)).toBe("CANCELLED");
    expect(await leads.publish(lead.id)).toBeNull();
  });

  it("does not affect another request's lead", async () => {
    const a = await makeLead();
    const b = await makeLead();
    await requests.updateStatus(a.request.id, "CANCELLED");
    expect(await statusOf(a.lead.id)).toBe("CANCELLED");
    expect(await statusOf(b.lead.id)).toBe("PUBLISHED");
  });

  it("a legacy-flow request (no lead) is processed as before and creates/changes no lead", async () => {
    const user = await createUser(prisma, { name: "Legacy" });
    const address = await createAddress(prisma, user.id);
    const customer = await createCustomerProfile(prisma, user.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await requests.updateStatus(request.id, "CANCELLED");
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("CANCELLED");
    expect(await prisma.lead.count()).toBe(0);
  });

  it("existing purchases are preserved untouched, and the cancelled lead is no longer purchasable", async () => {
    const { request, lead } = await makeLead();
    const proUser = await createUser(prisma, { name: "Pro" });
    const pro = await createProfessionalProfile(prisma, proUser.id);
    const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id, price: 5 });

    await requests.updateStatus(request.id, "CANCELLED");

    const after = await purchases.findById(purchase.id);
    expect(after).toMatchObject({ id: purchase.id, leadId: lead.id, status: "PENDING_PAYMENT" });

    const other = await createProfessionalProfile(prisma, (await createUser(prisma, { name: "Pro2" })).id);
    await expect(purchases.initiate({ leadId: lead.id, professionalProfileId: other.id, price: 5 })).rejects.toBeInstanceOf(LeadNotPurchasableError);
  });
});
