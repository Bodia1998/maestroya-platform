/**
 * Module 139 — Pre-Purchase Contact-Leak Protection against REAL PostgreSQL.
 *
 * "No CONFIRMED purchase -> no customer contact." Every professional-facing
 * LEAD_V1 read/write path (feed, preview, purchase initiation, confirmation,
 * lifecycle transitions) is exercised with realistic sentinel customer data and
 * must never return it; the ONLY path that may return it is the M138
 * GetLeadContactUseCase, and only while the caller's own purchase is CONFIRMED.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadContactAuthorizationReader, PrismaLeadContactReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository";
import { PrismaLeadFeedRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-feed-repository";
import { PrismaLeadPreviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-preview-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import { GetLeadFeedForProfessionalUseCase } from "@/application/use-cases/lead/get-lead-feed.use-case";
import { GetPublishedLeadPreviewUseCase, GetPublishedLeadPreviewsForProfessionalUseCase } from "@/application/use-cases/lead/get-published-lead-previews.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { M139_SECRET_ADDRESS, M139_SECRET_EMAIL, M139_SECRET_NAME, M139_SECRET_PHONE, M139_SECRET_POSTAL_CODE, assertNoContactLeak } from "../../test-utils/contact-leak-sentinels";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createAddress, createCustomerProfile, createProfessionalProfile, createServiceCategory, createServiceRequest, createUser } from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const BASE_LAT = 40.4168;
const BASE_LNG = -3.7038;
/** Prefixes that also catch the per-customer suffixed variants of the sentinels. */
const SENTINEL_PREFIXES = ["m139-secret-email", "M139_SECRET_ADDRESS", "+3460000999", "M139-9999", "M139 Secret Customer"];

describe("Module 139 — pre-purchase contact-leak protection (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const serviceRequests = new PrismaServiceRequestRepository();
  const previews = new PrismaLeadPreviewRepository();
  const professionals = new PrismaProfessionalRepository();
  const authReader = new PrismaLeadContactAuthorizationReader();
  const getContact = new GetLeadContactUseCase(new PrismaUserRepository(), professionals, authReader, new PrismaLeadContactReader());
  const confirm = new ConfirmLeadPurchaseUseCase(purchases, leads, serviceRequests);
  const transition = new TransitionLeadPurchaseUseCase(purchases);

  /** Discovery stub (not under test): every professional is eligible for `categoryId` right at the request's coordinates. */
  const discoveryFor = (categoryId: string): ProfessionalDiscoveryRepository =>
    ({
      findCandidateById: async (id: string) => ({ id, categoryIds: [categoryId], latitude: BASE_LAT, longitude: BASE_LNG, serviceRadiusKm: 50 }),
    }) as unknown as ProfessionalDiscoveryRepository;

  let seq = 0;
  beforeEach(() => {
    seq = 0;
  });

  async function publishedLead(opts: { category?: { id: string } } = {}) {
    // First customer in a test carries the EXACT sentinels; later ones a suffixed variant (unique columns).
    const n = seq;
    seq += 1;
    const suffix = n === 0 ? "" : `-${n}`;
    const email = n === 0 ? M139_SECRET_EMAIL : `m139-secret-email${suffix}@example.invalid`;
    const phone = n === 0 ? M139_SECRET_PHONE : `+3460000999${n}`;
    const customerUser = await createUser(prisma, { name: `${M139_SECRET_NAME}${suffix}`, email });
    await prisma.user.update({ where: { id: customerUser.id }, data: { phone } });
    const address = await createAddress(prisma, customerUser.id);
    await prisma.address.update({
      where: { id: address.id },
      data: { line1: `${M139_SECRET_ADDRESS}${suffix}`, postalCode: n === 0 ? M139_SECRET_POSTAL_CODE : `M139-9999${n}`, latitude: BASE_LAT, longitude: BASE_LNG },
    });
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = opts.category ?? (await createServiceCategory(prisma));
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id, maxBuyers: null });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, maxBuyers: 100 }))!;
    return { lead, request, customerUser, customer, address, category };
  }

  async function professional() {
    const user = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, user.id);
    return { user, profile };
  }

  const feedFor = (categoryId: string) => new GetLeadFeedForProfessionalUseCase(professionals, discoveryFor(categoryId), new PrismaLeadFeedRepository());
  const initiateFor = (categoryId: string) =>
    new InitiateLeadPurchaseUseCase(professionals, discoveryFor(categoryId), leads, serviceRequests, previews, purchases);

  const noLeak = (value: unknown) => assertNoContactLeak(value, SENTINEL_PREFIXES);
  const denied = async (p: Promise<unknown>) => expect(await p.then(() => null, (e: unknown) => e)).toBeInstanceOf(LeadContactAccessDeniedError);

  it("feed: the lead is listed, and the response holds no contact value, key, identifier or coordinate", async () => {
    const { lead, category } = await publishedLead();
    const pro = await professional();
    const page = await feedFor(category.id).execute(pro.user.id);
    expect(page.items.map((i) => i.leadId)).toEqual([lead.id]); // not vacuous
    noLeak(page);
    expect(JSON.stringify(page)).not.toContain(pro.profile.id);
    expect(Object.keys(page.items[0]!).sort()).toEqual(
      ["buyerPolicy", "categoryId", "categoryName", "city", "currency", "description", "distanceKm", "leadId", "price", "province", "publishedAt", "title", "urgency"],
    );
  });

  it("preview list and preview detail: no contact value, key or coordinate", async () => {
    const { lead, category } = await publishedLead();
    const pro = await professional();
    const list = await new GetPublishedLeadPreviewsForProfessionalUseCase(professionals, discoveryFor(category.id), previews).execute(pro.user.id);
    expect(list.map((i) => i.leadId)).toEqual([lead.id]);
    noLeak(list);
    const one = await new GetPublishedLeadPreviewUseCase(professionals, discoveryFor(category.id), previews).execute(pro.user.id, lead.id);
    noLeak(one);
  });

  it("feed and preview stay contact-safe for a professional who ALREADY holds a CONFIRMED purchase (contact only via M138)", async () => {
    const { lead, category } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm.execute(p.id);
    noLeak(await feedFor(category.id).execute(pro.user.id));
    noLeak(await new GetPublishedLeadPreviewsForProfessionalUseCase(professionals, discoveryFor(category.id), previews).execute(pro.user.id));
    // ...and M138 does release it:
    await expect(getContact.execute(pro.user.id, lead.id)).resolves.toMatchObject({ email: M139_SECRET_EMAIL, phone: M139_SECRET_PHONE });
  });

  it("purchase initiation (first call and idempotent replay) and confirmation return no contact data; contact stays behind M138", async () => {
    const { lead, category } = await publishedLead();
    const pro = await professional();
    const initiate = initiateFor(category.id);

    const first = await initiate.execute(pro.user.id, lead.id);
    const replay = await initiate.execute(pro.user.id, lead.id);
    expect(first.status).toBe("PENDING_PAYMENT");
    expect(replay.purchaseId).toBe(first.purchaseId);
    noLeak(first);
    noLeak(replay);
    await denied(getContact.execute(pro.user.id, lead.id)); // initiation did not unlock

    const confirmed = await confirm.execute(first.purchaseId);
    expect(confirmed.status).toBe("CONFIRMED");
    noLeak(confirmed);
    noLeak(await confirm.execute(first.purchaseId)); // idempotent repeat
    expect((await getContact.execute(pro.user.id, lead.id)).email).toBe(M139_SECRET_EMAIL);
  });

  it("no purchase -> denied", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it.each([
    ["PENDING_PAYMENT", []],
    ["FAILED", ["FAILED"]],
    ["CANCELLED", ["CANCELLED"]],
    ["REFUNDED", ["CONFIRMED", "REFUNDED"]],
    ["REVOKED", ["CONFIRMED", "REVOKED"]],
  ] as [LeadPurchaseStatus, LeadPurchaseStatus[]][])("current purchase state %s -> denied, and its lifecycle DTOs carry no contact", async (finalStatus, path) => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    for (const step of path) {
      const dto = step === "CONFIRMED" ? await confirm.execute(p.id) : await transition.execute(p.id, step);
      noLeak(dto);
    }
    expect((await purchases.findById(p.id))!.status).toBe(finalStatus);
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it("CONFIRMED -> contact via M138; REFUNDED / REVOKED immediately revoke it (no stale authorization)", async () => {
    for (const terminal of ["REFUNDED", "REVOKED"] as const) {
      const { lead } = await publishedLead();
      const pro = await professional();
      const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
      await confirm.execute(p.id);
      await expect(getContact.execute(pro.user.id, lead.id)).resolves.toMatchObject({ leadId: lead.id, email: expect.any(String) });
      noLeak(await transition.execute(p.id, terminal));
      await denied(getContact.execute(pro.user.id, lead.id));
    }
  });

  it("Professional B CONFIRMED on lead X does not give Professional A (any state) access to X", async () => {
    const x = await publishedLead();
    const a = await professional();
    const b = await professional();
    const pb = await purchases.initiate({ leadId: x.lead.id, professionalProfileId: b.profile.id });
    await confirm.execute(pb.id);
    await expect(getContact.execute(b.user.id, x.lead.id)).resolves.toMatchObject({ leadId: x.lead.id });

    await denied(getContact.execute(a.user.id, x.lead.id)); // no purchase
    const pa = await purchases.initiate({ leadId: x.lead.id, professionalProfileId: a.profile.id });
    await denied(getContact.execute(a.user.id, x.lead.id)); // PENDING_PAYMENT
    await transition.execute(pa.id, "CANCELLED");
    await denied(getContact.execute(a.user.id, x.lead.id)); // CANCELLED

    // A's denial is identical to a non-existent lead: nothing reveals B's purchase.
    const ghost = await getContact.execute(a.user.id, "99999999-9999-4999-8999-999999999999").then(() => null, (e: Error) => e);
    const real = await getContact.execute(a.user.id, x.lead.id).then(() => null, (e: Error) => e);
    expect(real!.message).toBe(ghost!.message);
    expect((real as LeadContactAccessDeniedError).code).toBe((ghost as LeadContactAccessDeniedError).code);
    expect(real!.message).not.toContain(b.profile.id);
    expect(real!.message).not.toContain(x.lead.id);
  });

  it("a CONFIRMED purchase on lead X cannot be used to read lead Y", async () => {
    const x = await publishedLead();
    const y = await publishedLead();
    const pro = await professional();
    const px = await purchases.initiate({ leadId: x.lead.id, professionalProfileId: pro.profile.id });
    await confirm.execute(px.id);
    await expect(getContact.execute(pro.user.id, x.lead.id)).resolves.toMatchObject({ leadId: x.lead.id });
    await denied(getContact.execute(pro.user.id, y.lead.id));
    // The returned contact belongs to X's customer only.
    const contact = await getContact.execute(pro.user.id, x.lead.id);
    expect(JSON.stringify(contact)).not.toContain("m139-secret-email-1");
  });

  it("legacy-flow lead cannot expose contact through the LEAD_V1 contact path even with a CONFIRMED row", async () => {
    const { lead, request } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm.execute(p.id);
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEGACY_QUOTE_PAYMENT" } });
    await denied(getContact.execute(pro.user.id, lead.id));
  });

  it("soft-deleted customer / inconsistent address ownership cannot expose contact", async () => {
    const a = await publishedLead();
    const proA = await professional();
    const pa = await purchases.initiate({ leadId: a.lead.id, professionalProfileId: proA.profile.id });
    await confirm.execute(pa.id);
    await prisma.customerProfile.update({ where: { id: a.customer.id }, data: { deletedAt: new Date() } });
    await denied(getContact.execute(proA.user.id, a.lead.id));

    const b = await publishedLead();
    const proB = await professional();
    const pb = await purchases.initiate({ leadId: b.lead.id, professionalProfileId: proB.profile.id });
    await confirm.execute(pb.id);
    const stranger = await createUser(prisma, { name: "Stranger" });
    const foreign = await createAddress(prisma, stranger.id);
    await prisma.serviceRequest.update({ where: { id: b.request.id }, data: { addressId: foreign.id } });
    await denied(getContact.execute(proB.user.id, b.lead.id));
  });

  it("repository projections: feed candidates and purchase records never carry contact or relation data", async () => {
    const { lead, category } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    await confirm.execute(p.id);

    const page = await new PrismaLeadFeedRepository().findPage({ categoryIds: [category.id], excludeCustomerUserId: pro.user.id, after: null, take: 10 });
    expect(page.map((c) => c.leadId)).toContain(lead.id);
    // Repository candidates intentionally keep coordinates + owner id for the radius / own-request rules
    // (they never reach a DTO - see the unit DTO tests); everything else must stay out.
    const internalOnly = ["latitude", "longitude", "customerUserId"];
    assertNoContactLeak(JSON.parse(JSON.stringify(page)), SENTINEL_PREFIXES, internalOnly);
    assertNoContactLeak(await previews.findPublishedById(lead.id), SENTINEL_PREFIXES, internalOnly);
    noLeak(await purchases.findById(p.id));
    noLeak(await leads.findById(lead.id));
  });
});
