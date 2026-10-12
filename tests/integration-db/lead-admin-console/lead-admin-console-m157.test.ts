/**
 * Module 157 — Lead Admin Operations Console reader against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the read model's Prisma selects run against the real schema, the LEAD_V1 scope, filters and pagination
 * bounds hold, READS NEVER MUTATE (row counts of every table the console projects are identical before and after), no contact /
 * provider / free-text field is ever returned (sentinel values seeded into the customer, address and payment reference), the audit
 * projection exposes only allow-listed scalar metadata, and a block imposed through the EXISTING M156 use case is visible in the
 * console (record written by M156, read by M157). Run with `npm run test:integration:db` (guarded test database — tests/test-utils/db).
 *
 * NOT RUN in the authoring environment (no PostgreSQL there; executing migrations / touching a database was out of bounds).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImposeLeadAbuseBlockUseCase } from "@/application/use-cases/lead-abuse/admin-lead-abuse.use-cases";
import { GetAdminLeadDetailUseCase, ListAdminLeadsUseCase } from "@/application/use-cases/lead-admin-console/lead-admin-console.use-cases";
import { SubmitLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/submit-lead-quality-claim.use-case";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaLeadAbuseControlRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-abuse-control-repository";
import { PrismaLeadAdminConsoleReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-admin-console-reader";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadQualityClaimRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-quality-claim-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";

import { assertNoContactLeak } from "../../test-utils/contact-leak-sentinels";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createAddress, createCustomerProfile, createProfessionalProfile, createServiceCategory, createServiceRequest, createUser } from "../../test-utils/db/seed-helpers";
import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";

vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const SECRET_EMAIL = "m157-secret-customer@test.maestroya.invalid";
const SECRET_NAME = "M157 Secret Customer Name";
const SECRET_PAYMENT_REF = "pi_m157_secret_reference";

describe("Module 157 — lead admin console reader (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const claims = new PrismaLeadQualityClaimRepository();
  const professionals = new PrismaProfessionalRepository();
  const admins = new PrismaAdminRepository();
  const control = new PrismaLeadAbuseControlRepository();
  const reader = new PrismaLeadAdminConsoleReader();
  let seq = 0;

  const listUc = () => new ListAdminLeadsUseCase(admins, reader);
  const detailUc = () => new GetAdminLeadDetailUseCase(admins, reader);

  async function newAdmin() {
    seq += 1;
    const user = await createUser(prisma, { name: `Admin ${seq}`, email: `m157-admin-${seq}@test.maestroya.invalid` });
    const role = await prisma.role.upsert({ where: { key: "ADMIN" }, update: {}, create: { key: "ADMIN", name: "ADMIN" } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return user.id;
  }
  async function newProfessional() {
    seq += 1;
    const user = await createUser(prisma, { name: `Pro ${seq}`, email: `m157-pro-${seq}@test.maestroya.invalid` });
    const profile = await createProfessionalProfile(prisma, user.id);
    return { userId: user.id, profileId: profile.id };
  }

  let world: { customerUserId: string; addressId: string; customerId: string; categoryId: string } | null = null;
  beforeEach(() => {
    world = null; // the lifecycle truncates before every test
  });
  async function customerWorld() {
    if (world) return world;
    const user = await createUser(prisma, { name: SECRET_NAME, email: SECRET_EMAIL });
    const address = await createAddress(prisma, user.id);
    const customer = await createCustomerProfile(prisma, user.id);
    const category = await createServiceCategory(prisma);
    world = { customerUserId: user.id, addressId: address.id, customerId: customer.id, categoryId: category.id };
    return world;
  }

  /**
   * A published lead. A Lead can only be created and published on a LEAD_V1 request (assertLeadEligibleFlow), so the request is
   * ALWAYS LEAD_V1 while the lead is built. `LEGACY_QUOTE_PAYMENT` then moves that request to the genuine legacy flow afterwards,
   * which is the only way a lead can end up outside LEAD_V1; the console must not show it.
   */
  async function publishedLead(flow: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT" = "LEAD_V1") {
    const w = await customerWorld();
    const request = await createServiceRequest(prisma, { customerId: w.customerId, categoryId: w.categoryId, addressId: w.addressId });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price: "100.00", maxBuyers: 10 }))!;
    if (flow === "LEGACY_QUOTE_PAYMENT") await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEGACY_QUOTE_PAYMENT" } });
    return lead;
  }
  async function confirmedPurchase(leadId: string, profileId: string) {
    const purchase = await purchases.initiate({ leadId, professionalProfileId: profileId });
    await purchases.recordPaymentReference(purchase.id, SECRET_PAYMENT_REF);
    expect((await purchases.transition(purchase.id, "PENDING_PAYMENT", "CONFIRMED", new Date()))?.status).toBe("CONFIRMED");
    return purchase.id;
  }

  /** Row counts of every table the console projects (and the ones it must never touch). */
  async function snapshotCounts() {
    return {
      lead: await prisma.lead.count(),
      leadPurchase: await prisma.leadPurchase.count(),
      claim: await prisma.leadQualityClaim.count(),
      abuseSignal: await prisma.leadAbuseSignal.count(),
      abuseDecision: await prisma.leadAbuseDecision.count(),
      audit: await prisma.auditLog.count(),
      user: await prisma.user.count(),
    };
  }

  it("lists LEAD_V1 leads only, with bounded pages and a stable order", async () => {
    const admin = await newAdmin();
    for (let i = 0; i < 3; i += 1) await publishedLead("LEAD_V1");
    const legacy = await publishedLead("LEGACY_QUOTE_PAYMENT");

    const all = await listUc().execute(admin, { limit: 100 });
    expect(all.map((r) => r.id)).not.toContain(legacy.id);
    expect(all).toHaveLength(3);

    const page1 = await listUc().execute(admin, { limit: 2, offset: 0 });
    const page2 = await listUc().execute(admin, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    expect(new Set([...page1, ...page2].map((r) => r.id)).size).toBe(3);
  });

  it("filters by status, purchase status, id and region, and counts purchases / open claims", async () => {
    const admin = await newAdmin();
    const pro = await newProfessional();
    const bought = await publishedLead();
    const untouched = await publishedLead();
    const purchaseId = await confirmedPurchase(bought.id, pro.profileId);

    const byPurchase = await listUc().execute(admin, { purchaseStatus: "CONFIRMED" });
    expect(byPurchase.map((r) => r.id)).toEqual([bought.id]);
    expect(byPurchase[0]?.purchaseCounts).toMatchObject({ CONFIRMED: 1 });

    expect((await listUc().execute(admin, { leadId: untouched.id })).map((r) => r.id)).toEqual([untouched.id]);
    expect(await listUc().execute(admin, { status: "EXPIRED" })).toEqual([]);

    await new SubmitLeadQualityClaimUseCase(professionals, purchases, claims).execute(pro.userId, {
      leadPurchaseId: purchaseId,
      reasonCode: "CONTACT_UNREACHABLE",
      description: "The phone number never answers and messages bounce.",
    });
    const afterClaim = await listUc().execute(admin, { leadId: bought.id });
    expect(afterClaim[0]?.openClaims).toBe(1);
  });

  it("lead detail exposes confirmed facts and NO contact, name, e-mail, address line or payment reference", async () => {
    const admin = await newAdmin();
    const pro = await newProfessional();
    const lead = await publishedLead();
    const purchaseId = await confirmedPurchase(lead.id, pro.profileId);
    await new SubmitLeadQualityClaimUseCase(professionals, purchases, claims).execute(pro.userId, {
      leadPurchaseId: purchaseId,
      reasonCode: "CONTACT_UNREACHABLE",
      description: "The phone number never answers and messages bounce.",
    });

    const view = await detailUc().execute(admin, lead.id);
    expect(view.lead.id).toBe(lead.id);
    expect(view.purchases.map((p) => p.id)).toEqual([purchaseId]);
    expect(view.purchases[0]).toMatchObject({ status: "CONFIRMED", hasPaymentReference: true });
    expect(view.claims).toHaveLength(1);

    // customerUserId is an opaque id the console intentionally shows (for abuse-subject lookups); everything else must be clean.
    assertNoContactLeak(view, [SECRET_EMAIL, SECRET_NAME, SECRET_PAYMENT_REF], ["customerUserId"]);
    expect(JSON.stringify(view)).not.toContain(SECRET_PAYMENT_REF);
  });

  it("a missing or non-LEAD_V1 lead is a closed not-found", async () => {
    const admin = await newAdmin();
    const legacy = await publishedLead("LEGACY_QUOTE_PAYMENT");
    for (const id of ["00000000-0000-4000-a000-0000000000ff", legacy.id]) {
      await expect(detailUc().execute(admin, id)).rejects.toMatchObject({ reason: "LEAD_NOT_FOUND" });
    }
  });

  it("READS NEVER MUTATE: every projected table is identical before and after listing and investigating", async () => {
    const admin = await newAdmin();
    const pro = await newProfessional();
    const lead = await publishedLead();
    await confirmedPurchase(lead.id, pro.profileId);

    const before = await snapshotCounts();
    const rowBefore = await prisma.leadPurchase.findMany({ orderBy: { id: "asc" } });
    await listUc().execute(admin, {});
    await detailUc().execute(admin, lead.id);
    await reader.listClaims({ limit: 20, offset: 0 });
    await reader.listDisputes({ limit: 20, offset: 0 });
    await reader.getAbuseSubject(pro.userId);
    expect(await snapshotCounts()).toEqual(before);
    expect(await prisma.leadPurchase.findMany({ orderBy: { id: "asc" } })).toEqual(rowBefore);
  });

  it("an unauthorized actor reads nothing (fail-closed re-check against the real admin table)", async () => {
    const pro = await newProfessional();
    await publishedLead();
    await expect(listUc().execute(pro.userId, {})).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
    await expect(detailUc().execute("00000000-0000-4000-a000-0000000000aa", "00000000-0000-4000-a000-0000000000bb")).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
  });

  it("a block imposed via the EXISTING M156 use case is audited and visible in the console subject view; the console wrote nothing itself", async () => {
    const admin = await newAdmin();
    const pro = await newProfessional();
    const impose = new ImposeLeadAbuseBlockUseCase(admins, control);
    const decision = await impose.execute(admin, {
      subjectUserId: pro.userId,
      restrictedAction: "LEAD_PURCHASE_INITIATION",
      durationMs: 3_600_000,
      explanation: "Confirmed scraping of lead previews",
    });

    const subject = await reader.getAbuseSubject(pro.userId);
    expect(subject?.decisions.map((d) => d.id)).toEqual([decision.id]);
    expect(subject?.decisions[0]).toMatchObject({ status: "ACTIVE", origin: "ADMIN", restrictedAction: "LEAD_PURCHASE_INITIATION" });

    const audit = await prisma.auditLog.findMany({ where: { entityId: decision.id } });
    expect(audit.length).toBe(1);
    expect(audit[0]).toMatchObject({ actorUserId: admin });
  });

  it("audit entries shown for a lead carry only allow-listed scalar metadata (no free text)", async () => {
    const admin = await newAdmin();
    const lead = await publishedLead();
    await prisma.auditLog.create({
      data: {
        actorUserId: admin,
        action: "STATUS_CHANGE",
        entityType: "LeadQualityClaim",
        entityId: lead.id,
        metadata: { adminAction: "LEAD_QUALITY_CLAIM_DECIDED", fromStatus: "UNDER_REVIEW", toStatus: "APPROVED", explanation: "FREE TEXT SECRET", nested: { a: 1 } },
      },
    });
    const record = await reader.getLeadDetail(lead.id);
    const entry = record?.audit.find((a) => a.action === "LEAD_QUALITY_CLAIM_DECIDED");
    if (entry) {
      expect(entry.metadata).toEqual({ adminAction: "LEAD_QUALITY_CLAIM_DECIDED", fromStatus: "UNDER_REVIEW", toStatus: "APPROVED" });
    }
    expect(JSON.stringify(record)).not.toContain("FREE TEXT SECRET");
  });
});
