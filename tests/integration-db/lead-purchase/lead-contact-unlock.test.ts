/**
 * Module 138 — Contact Unlock End-to-End against REAL PostgreSQL.
 *
 * Proves the authorization boundary that mocks cannot: the Prisma adapter's
 * scoping by (lead, professional, CONFIRMED), dynamic loss of access on
 * REFUNDED/REVOKED, the LEAD_V1-only / ownership guards, and that the M134
 * feed read never carries contact data.
 */
import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadContactAuthorizationReader, PrismaLeadContactReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository";
import { PrismaLeadFeedRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-feed-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";

import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import {
  createAddress,
  createCustomerProfile,
  createProfessionalProfile,
  createServiceCategory,
  createServiceRequest,
  createUser,
} from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("Module 138 — contact unlock (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const serviceRequests = new PrismaServiceRequestRepository();
  const authReader = new PrismaLeadContactAuthorizationReader();
  const contactReader = new PrismaLeadContactReader();
  const getContact = new GetLeadContactUseCase(new PrismaUserRepository(), new PrismaProfessionalRepository(), authReader, contactReader);
  const confirm = () => new ConfirmLeadPurchaseUseCase(purchases, leads, serviceRequests);
  const transition = () => new TransitionLeadPurchaseUseCase(purchases);

  // Every publishedLead() call needs its own customer (users.email / users.phone are unique, and one
  // test may publish several leads). DB is truncated before each test, so a deterministic per-file
  // counter is enough; it never repeats within a run.
  let customerSeq = 0;

  async function publishedLead(flow: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT" = "LEAD_V1") {
    customerSeq += 1;
    const customerEmail = `m138-customer-${customerSeq}@test.maestroya.invalid`;
    const customerPhone = `+3460000${String(customerSeq).padStart(4, "0")}`;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email: customerEmail });
    await prisma.user.update({ where: { id: customerUser.id }, data: { phone: customerPhone } });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id, maxBuyers: null });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, maxBuyers: 100 }))!;
    if (flow !== "LEAD_V1") await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: flow } });
    return { lead, request, customerUser, address, customer, category, customerEmail, customerPhone };
  }

  async function professional() {
    const user = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, user.id);
    return { user, profile };
  }

  const denied = async (p: Promise<unknown>) => expect(await p.then(() => null, (e: unknown) => e)).toBeInstanceOf(LeadContactAccessDeniedError);

  it("PENDING_PAYMENT -> CONFIRMED -> contact; CONFIRMED -> REFUNDED -> no contact", async () => {
    const { lead, customerEmail, customerPhone } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await denied(getContact.execute(pro.user.id, lead.id));

    await confirm().execute(p.id);
    const dto = await getContact.execute(pro.user.id, lead.id);
    expect(dto).toMatchObject({ leadId: lead.id, customerDisplayName: "Ana Cliente", email: customerEmail, phone: customerPhone, address: { line1: "Calle de Prueba 1", postalCode: "46001", city: "Valencia" } });
    expect(Object.keys(dto).sort()).toEqual(["address", "customerDisplayName", "email", "leadId", "phone"]);

    await transition().execute(p.id, "REFUNDED");
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it("CONFIRMED -> REVOKED -> no contact (no stale authorization)", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm().execute(p.id);
    await expect(getContact.execute(pro.user.id, lead.id)).resolves.toMatchObject({ leadId: lead.id });
    await transition().execute(p.id, "REVOKED");
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it.each(["FAILED", "CANCELLED"] as const)("%s purchase -> no contact", async (terminal) => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await transition().execute(p.id, terminal);
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it("adapter scoping: wrong professional / wrong lead return no CONFIRMED grant", async () => {
    const a = await publishedLead();
    const b = await publishedLead();
    const buyer = await professional();
    const other = await professional();
    const p = await purchases.initiate({ leadId: a.lead.id, professionalProfileId: buyer.profile.id });
    await confirm().execute(p.id);

    expect((await authReader.findFacts(a.lead.id, buyer.profile.id))!.grant).toEqual({ state: "CONFIRMED", professionalProfileId: buyer.profile.id });
    expect((await authReader.findFacts(a.lead.id, other.profile.id))!.grant).toBeNull();
    expect((await authReader.findFacts(b.lead.id, buyer.profile.id))!.grant).toBeNull();
    expect(await authReader.findFacts("99999999-9999-4999-8999-999999999999", buyer.profile.id)).toBeNull();

    await denied(getContact.execute(other.user.id, a.lead.id));
    await denied(getContact.execute(buyer.user.id, b.lead.id));
  });

  it("a professional with a confirmed purchase cannot read another lead's customer by lead id", async () => {
    const a = await publishedLead();
    const b = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: a.lead.id, professionalProfileId: pro.profile.id });
    await confirm().execute(p.id);
    const own = await getContact.execute(pro.user.id, a.lead.id);
    expect(own.leadId).toBe(a.lead.id);
    await denied(getContact.execute(pro.user.id, b.lead.id));
  });

  it("re-purchase after a terminal state: a confirmed row wins over older terminal rows; a latest terminal row denies", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const first = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await transition().execute(first.id, "FAILED");
    const second = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm().execute(second.id);
    await expect(getContact.execute(pro.user.id, lead.id)).resolves.toMatchObject({ leadId: lead.id });
    await transition().execute(second.id, "REVOKED");
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it("legacy-flow request never unlocks contact, even with a CONFIRMED purchase row", async () => {
    const { lead, request } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm().execute(p.id);
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEGACY_QUOTE_PAYMENT" } });
    await denied(getContact.execute(pro.user.id, lead.id));
    expect(await contactReader.readContact(lead.id)).toBeNull();
  });

  it("customer ownership mismatch (address of a different user) denies and reads nothing", async () => {
    const { lead, request } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm().execute(p.id);

    const stranger = await createUser(prisma, { name: "Stranger" });
    const foreignAddress = await createAddress(prisma, stranger.id);
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { addressId: foreignAddress.id } });

    expect((await authReader.findFacts(lead.id, pro.profile.id))!.contactOwnershipConsistent).toBe(false);
    expect(await contactReader.readContact(lead.id)).toBeNull();
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it("soft-deleted service request blocks contact", async () => {
    const { lead, request } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm().execute(p.id);
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { deletedAt: new Date() } });
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it("M134 feed read stays contact-safe: no contact value or private column in candidates", async () => {
    const { lead, category, customerEmail, customerPhone } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm().execute(p.id);

    const page = await new PrismaLeadFeedRepository().findPage({ categoryIds: [category.id], excludeCustomerUserId: pro.user.id, after: null, take: 10 });
    expect(page.map((c) => c.leadId)).toContain(lead.id);
    const json = JSON.stringify(page);
    for (const secret of [customerEmail, customerPhone, "Ana Cliente", "Calle de Prueba", "46001"]) expect(json).not.toContain(secret);
    for (const key of ["email", "phone", "line1", "postalCode", "purchases", "professionalProfileId"]) expect(json).not.toContain(`"${key}"`);
  });
});
