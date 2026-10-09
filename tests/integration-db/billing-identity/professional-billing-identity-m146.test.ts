/**
 * Module 146 — Professional Billing Identity against REAL PostgreSQL (migration + Prisma adapter).
 *
 * Proves what fakes cannot: the additive migration leaves existing professionals with NO billing
 * identity (MISSING, never billing-ready), the adapter can only create UNVERIFIED rows, a material
 * change resets a verification both through the adapter AND through raw SQL (trigger), admin decisions
 * are bound to the reviewed revision under concurrency, CHECK constraints reject malformed or
 * forged rows, and the M17/M98 professional verification state is a separate, untouched concept.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaProfessionalBillingIdentityRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-billing-identity-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { GetMyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/get-my-billing-identity.use-case";
import { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";
import { RejectBillingIdentityUseCase, VerifyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/review-billing-identity.use-cases";
import { SaveMyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/save-my-billing-identity.use-case";
import { saveBillingIdentitySchema } from "@/application/dto/professional-billing-identity.dto";
import { assertValidBillingIdentityDetails } from "@/domain/services/professional-billing-identity";
import { ConflictError } from "@/domain/errors/domain-error";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createProfessionalProfile, createUser } from "../../test-utils/db/seed-helpers";

const INPUT = {
  entityType: "COMPANY",
  legalName: "Fontanería Mediterránea S.L.",
  taxId: "B12345674",
  taxCountry: "ES",
  addressLine1: "Carrer Major 12",
  city: "Gandia",
  region: "Valencia",
  postalCode: "46700",
  country: "ES",
};
const details = (patch: Record<string, unknown> = {}) => assertValidBillingIdentityDetails({ ...INPUT, ...patch });

describe("Module 146 — professional billing identity (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const identities = new PrismaProfessionalBillingIdentityRepository();
  const professionals = new PrismaProfessionalRepository();

  async function pro(label = "Pro") {
    const user = await createUser(prisma, { name: label });
    const profile = await createProfessionalProfile(prisma, user.id);
    return { user, profile };
  }
  async function admin() {
    return createUser(prisma, { name: "Admin" });
  }

  it("existing professionals (created before the feature) have no billing identity and are not billing-ready, whatever their M98 status", async () => {
    const { profile } = await pro();
    expect(profile.verificationStatus).toBe("VERIFIED"); // M98/M17 verified…
    expect(await identities.findByProfessionalProfileId(profile.id)).toBeNull();
    const readiness = await new GetProfessionalBillingReadinessUseCase(identities).execute(profile.id);
    expect(readiness).toMatchObject({ state: "MISSING", isComplete: false, isVerified: false, billingReady: false, snapshot: null });
    expect(await prisma.professionalBillingIdentity.count()).toBe(0);
  });

  it("creating details yields UNVERIFIED revision 1 with no verification metadata, normalised and persisted", async () => {
    const { profile } = await pro();
    const { record, changed } = await identities.saveDetails(profile.id, details({ taxId: "b-123.456 74", taxCountry: "es" }));
    expect(changed).toBe(true);
    expect(record).toMatchObject({ verificationStatus: "UNVERIFIED", revision: 1, verifiedAt: null, reviewedAt: null, reviewedByUserId: null, rejectionReason: null, reviewNote: null, taxId: "B12345674", taxCountry: "ES" });
  });

  it("the use case path never verifies and never touches the professional's M98 verification state", async () => {
    const { user, profile } = await pro();
    await prisma.professionalProfile.update({ where: { id: profile.id }, data: { verificationStatus: "REJECTED" } });
    const view = await new SaveMyBillingIdentityUseCase(professionals, identities).execute(user.id, saveBillingIdentitySchema.parse({ ...INPUT, verificationStatus: "VERIFIED" }));
    expect(view.state).toBe("PENDING_REVIEW");
    const after = await prisma.professionalProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(after.verificationStatus).toBe("REJECTED");
    expect(after.taxId).toBeNull();
    expect(after.businessName).toBeNull();
  });

  it("an administrator verifies the reviewed revision; identical re-save keeps it; a material edit resets it", async () => {
    const { profile } = await pro();
    const reviewer = await admin();
    const { record } = await identities.saveDetails(profile.id, details());
    const verify = new VerifyBillingIdentityUseCase(identities);
    const verified = await verify.execute(reviewer.id, { identityId: record.id, expectedRevision: 1 });
    expect(verified.state).toBe("VERIFIED");

    const same = await identities.saveDetails(profile.id, details());
    expect(same.changed).toBe(false);
    expect(same.record.verificationStatus).toBe("VERIFIED");
    expect(same.record.revision).toBe(1);

    const edited = await identities.saveDetails(profile.id, details({ city: "Valencia" }));
    expect(edited.changed).toBe(true);
    expect(edited.record).toMatchObject({ verificationStatus: "UNVERIFIED", revision: 2, verifiedAt: null, reviewedAt: null, reviewedByUserId: null });
    const readiness = await new GetProfessionalBillingReadinessUseCase(identities).execute(profile.id);
    expect(readiness.billingReady).toBe(false);
  });

  it.each([
    ["entityType", { entityType: "INDIVIDUAL" }],
    ["legalName", { legalName: "Otro Nombre S.L." }],
    ["taxId", { taxId: "B87654321" }],
    ["taxCountry", { taxCountry: "PT" }],
    ["addressLine1", { addressLine1: "Otra calle 9" }],
    ["addressLine2", { addressLine2: "Piso 2" }],
    ["city", { city: "Valencia" }],
    ["region", { region: "Alicante" }],
    ["postalCode", { postalCode: "46001" }],
    ["country", { country: "PT" }],
  ])("RAW SQL: changing %s on a VERIFIED row resets it via the database trigger (no application code involved)", async (_field, patch) => {
    const { profile } = await pro();
    const reviewer = await admin();
    const { record } = await identities.saveDetails(profile.id, details());
    await new VerifyBillingIdentityUseCase(identities).execute(reviewer.id, { identityId: record.id, expectedRevision: 1 });

    const column = Object.keys(patch)[0];
    const value = Object.values(patch)[0] as string;
    const cast = column === "entityType" ? '::"BillingEntityType"' : "";
    await prisma.$executeRawUnsafe(`UPDATE professional_billing_identities SET "${column}" = $1${cast} WHERE id = $2::uuid`, value, record.id);

    const row = await prisma.professionalBillingIdentity.findUniqueOrThrow({ where: { id: record.id } });
    expect(row).toMatchObject({ verificationStatus: "UNVERIFIED", revision: 2, verifiedAt: null, reviewedAt: null, reviewedByUserId: null, rejectionReason: null, reviewNote: null });
  });

  it("RAW SQL: a forged change that also writes VERIFIED metadata in the same statement is still reset", async () => {
    const { profile } = await pro();
    const { record } = await identities.saveDetails(profile.id, details());
    await prisma.$executeRawUnsafe(`UPDATE professional_billing_identities SET "legalName" = 'Forged', "verificationStatus" = 'VERIFIED', "verifiedAt" = now(), "reviewedAt" = now() WHERE id = $1::uuid`, record.id);
    const row = await prisma.professionalBillingIdentity.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.verificationStatus).toBe("UNVERIFIED");
    expect(row.verifiedAt).toBeNull();
  });

  it("a row cannot be created VERIFIED, with the retired PENDING status, or with an out-of-sync revision/ownership change", async () => {
    const { profile } = await pro();
    const other = await pro("Other");
    const base = { professionalProfileId: profile.id, ...details() };
    await expect(prisma.professionalBillingIdentity.create({ data: { ...base, verificationStatus: "VERIFIED", verifiedAt: new Date(), reviewedAt: new Date() } })).rejects.toThrow(/created UNVERIFIED|check/i);
    await expect(prisma.professionalBillingIdentity.create({ data: { ...base, verificationStatus: "PENDING" } })).rejects.toThrow();
    const created = await prisma.professionalBillingIdentity.create({ data: base });
    await expect(prisma.professionalBillingIdentity.update({ where: { id: created.id }, data: { revision: 41 } })).rejects.toThrow(/revision/i);
    await expect(prisma.professionalBillingIdentity.update({ where: { id: created.id }, data: { professionalProfileId: other.profile.id } })).rejects.toThrow(/ownership|immutable/i);
  });

  it("CHECK constraints reject forged or malformed rows", async () => {
    const { profile } = await pro();
    const { record } = await identities.saveDetails(profile.id, details());
    const bad = (data: Record<string, unknown>) => prisma.professionalBillingIdentity.update({ where: { id: record.id }, data: data as never });
    await expect(bad({ verificationStatus: "VERIFIED" })).rejects.toThrow(); // no verifiedAt/reviewedAt
    await expect(bad({ verificationStatus: "REJECTED", reviewedAt: new Date() })).rejects.toThrow(); // no reason
    await expect(bad({ rejectionReason: "OTHER" })).rejects.toThrow(); // reason without REJECTED
    await expect(bad({ taxId: "b12345674" })).rejects.toThrow(); // not canonical
    await expect(bad({ taxId: "AB1" })).rejects.toThrow();
    await expect(bad({ country: "e1" })).rejects.toThrow();
    await expect(bad({ legalName: "   " })).rejects.toThrow();
    await expect(bad({ postalCode: " " })).rejects.toThrow();
  });

  it("administrator decisions are bound to the reviewed revision (stale decisions change nothing)", async () => {
    const { profile } = await pro();
    const reviewer = await admin();
    const { record } = await identities.saveDetails(profile.id, details());
    await identities.saveDetails(profile.id, details({ legalName: "Edited After Review S.L." })); // revision 2

    const verify = new VerifyBillingIdentityUseCase(identities);
    await expect(verify.execute(reviewer.id, { identityId: record.id, expectedRevision: 1 })).rejects.toBeInstanceOf(ConflictError);
    expect((await identities.findById(record.id))?.verificationStatus).toBe("UNVERIFIED");
    await expect(new RejectBillingIdentityUseCase(identities).execute(reviewer.id, { identityId: record.id, expectedRevision: 1, reason: "OTHER", note: null })).rejects.toBeInstanceOf(ConflictError);
    expect((await identities.findById(record.id))?.verificationStatus).toBe("UNVERIFIED");
  });

  it("concurrent verification and professional edit converge safely: content is never VERIFIED without having been reviewed", async () => {
    for (let i = 0; i < 5; i += 1) {
      const { profile } = await pro(`Racer ${i}`);
      const reviewer = await admin();
      const { record } = await identities.saveDetails(profile.id, details());
      const verify = new VerifyBillingIdentityUseCase(identities).execute(reviewer.id, { identityId: record.id, expectedRevision: 1 }).then(() => "verified", () => "conflict");
      const edit = identities.saveDetails(profile.id, details({ legalName: `Edited ${i} S.L.` }));
      await Promise.all([verify, edit]);
      const row = (await identities.findById(record.id))!;
      // Either order is acceptable, but a VERIFIED row must never carry the edited, unreviewed content.
      if (row.verificationStatus === "VERIFIED") expect(row.legalName).toBe(INPUT.legalName);
      else expect(row.legalName).toBe(`Edited ${i} S.L.`);
      expect(row.legalName === INPUT.legalName || row.verificationStatus === "UNVERIFIED").toBe(true);
    }
  });

  it("two concurrent first saves create exactly one row", async () => {
    const { profile } = await pro();
    const results = await Promise.all([identities.saveDetails(profile.id, details()), identities.saveDetails(profile.id, details())]);
    expect(await prisma.professionalBillingIdentity.count({ where: { professionalProfileId: profile.id } })).toBe(1);
    expect(results.every((r) => r.record.professionalProfileId === profile.id)).toBe(true);
  });

  it("rejection records a closed reason and an internal note that the professional read path never returns", async () => {
    const { user, profile } = await pro();
    const reviewer = await admin();
    const { record } = await identities.saveDetails(profile.id, details());
    await new RejectBillingIdentityUseCase(identities).execute(reviewer.id, { identityId: record.id, expectedRevision: 1, reason: "TAX_ID_MISMATCH", note: "INTERNAL-NOTE-XYZ" });
    const row = await prisma.professionalBillingIdentity.findUniqueOrThrow({ where: { id: record.id } });
    expect(row).toMatchObject({ verificationStatus: "REJECTED", rejectionReason: "TAX_ID_MISMATCH", reviewNote: "INTERNAL-NOTE-XYZ", verifiedAt: null });
    const view = await new GetMyBillingIdentityUseCase(professionals, identities).execute(user.id);
    expect(view.state).toBe("NEEDS_CORRECTION");
    expect(JSON.stringify(view)).not.toMatch(/INTERNAL-NOTE-XYZ|reviewNote|reviewedBy/);
  });

  it("ownership: a professional can only read their own identity; identical tax ids on two professionals do not collide or leak", async () => {
    const a = await pro("A");
    const b = await pro("B");
    await identities.saveDetails(a.profile.id, details({ legalName: "A S.L." }));
    await identities.saveDetails(b.profile.id, details({ legalName: "B S.L." })); // same tax id on purpose
    const read = new GetMyBillingIdentityUseCase(professionals, identities);
    expect((await read.execute(a.user.id)).details?.legalName).toBe("A S.L.");
    expect((await read.execute(b.user.id)).details?.legalName).toBe("B S.L.");
  });

  it("deleting the professional profile removes its billing identity; deleting the reviewing admin keeps the decision", async () => {
    const { profile } = await pro();
    const reviewer = await admin();
    const { record } = await identities.saveDetails(profile.id, details());
    await new VerifyBillingIdentityUseCase(identities).execute(reviewer.id, { identityId: record.id, expectedRevision: 1 });
    await prisma.user.delete({ where: { id: reviewer.id } });
    const kept = await prisma.professionalBillingIdentity.findUniqueOrThrow({ where: { id: record.id } });
    expect(kept.verificationStatus).toBe("VERIFIED");
    expect(kept.reviewedByUserId).toBeNull();

    await prisma.professionalProfile.delete({ where: { id: profile.id } });
    expect(await prisma.professionalBillingIdentity.count()).toBe(0);
  });

  it("the review queue lists only UNVERIFIED identities, oldest first", async () => {
    const reviewer = await admin();
    const first = await pro("First");
    const second = await pro("Second");
    const third = await pro("Third");
    const a = await identities.saveDetails(first.profile.id, details());
    await identities.saveDetails(second.profile.id, details({ taxId: "B87654321" }));
    const c = await identities.saveDetails(third.profile.id, details({ taxId: "B11111111" }));
    await new VerifyBillingIdentityUseCase(identities).execute(reviewer.id, { identityId: c.record.id, expectedRevision: 1 });
    const queue = await identities.listPendingReview({ limit: 10, offset: 0 });
    expect(queue.map((r) => r.professionalProfileId)).toEqual([first.profile.id, second.profile.id]);
    expect(queue[0]!.id).toBe(a.record.id);
  });

  it("adds no purchase-side coupling: an M98-VERIFIED professional with NO billing identity is untouched, and lead_purchases gained no billing trigger", async () => {
    // M146 adds no gate: the existing M126/M135/M140/M141 suites in this tier run unchanged and still
    // pass; the static boundary test pins the source side.
    const { profile } = await pro();
    expect(await identities.findByProfessionalProfileId(profile.id)).toBeNull();
    const tables = await prisma.$queryRawUnsafe<{ tgname: string }[]>(
      `SELECT tgname::text AS tgname FROM pg_trigger WHERE tgrelid = 'lead_purchases'::regclass AND NOT tgisinternal`,
    );
    expect(tables.map((t) => t.tgname).some((n) => /billing/i.test(n))).toBe(false);
  });
});
