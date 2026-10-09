import { describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository, RecordAdminAuditLogData } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { MATERIAL_BILLING_FIELDS } from "@/domain/services/professional-billing-identity";
import {
  listPendingBillingIdentitiesSchema,
  rejectBillingIdentitySchema,
  saveBillingIdentitySchema,
  type SaveBillingIdentityInput,
} from "@/application/dto/professional-billing-identity.dto";
import { GetMyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/get-my-billing-identity.use-case";
import { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";
import {
  GetBillingIdentityForAdminReviewUseCase,
  ListBillingIdentitiesPendingReviewUseCase,
  RejectBillingIdentityUseCase,
  VerifyBillingIdentityUseCase,
} from "@/application/use-cases/billing-identity/review-billing-identity.use-cases";
import { SaveMyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/save-my-billing-identity.use-case";

import { FakeProfessionalBillingIdentityRepository, VALID_BILLING_INPUT } from "../../../../test-utils/fake-professional-billing-identity-repository";

const firstRow = (repo: FakeProfessionalBillingIdentityRepository) => {
  const row = [...repo.rows.values()][0];
  if (!row) throw new Error("expected a stored billing identity");
  return row;
};

const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * Only `findByUserId` exists. Any other call (`update`, `setVerificationStatus`, …) throws,
 * proving the billing flow never touches the M17/M98 professional verification state.
 */
function professionalsFake(): ProfessionalRepository {
  const profiles: Record<string, { id: string; userId: string; verificationStatus: string }> = {
    "user-a": { id: PROFILE_A, userId: "user-a", verificationStatus: "VERIFIED" },
    "user-b": { id: PROFILE_B, userId: "user-b", verificationStatus: "UNVERIFIED" },
  };
  return new Proxy({} as ProfessionalRepository, {
    get(_t, prop) {
      if (prop === "findByUserId") return async (userId: string) => profiles[userId] ?? null;
      throw new Error(`billing identity must not call ProfessionalRepository.${String(prop)}`);
    },
  });
}

function auditFake() {
  const entries: RecordAdminAuditLogData[] = [];
  const repo: AdminAuditLogRepository = {
    async record(data) {
      entries.push(data);
      return { id: "log", createdAt: new Date(), metadata: data.metadata ?? null, ...data } as never;
    },
    async list() {
      return [];
    },
  };
  return { repo, entries };
}

const parse = (patch: Record<string, unknown> = {}): SaveBillingIdentityInput => saveBillingIdentitySchema.parse({ ...VALID_BILLING_INPUT, ...patch });

function setup() {
  const identities = new FakeProfessionalBillingIdentityRepository();
  const audit = auditFake();
  const save = new SaveMyBillingIdentityUseCase(professionalsFake(), identities, audit.repo);
  const get = new GetMyBillingIdentityUseCase(professionalsFake(), identities);
  const verify = new VerifyBillingIdentityUseCase(identities, audit.repo);
  const reject = new RejectBillingIdentityUseCase(identities, audit.repo);
  return { identities, audit, save, get, verify, reject };
}

describe("M146 DTO schema", () => {
  it("normalises input and drops client-supplied status, ids and review fields", () => {
    const parsed = saveBillingIdentitySchema.parse({
      ...VALID_BILLING_INPUT,
      taxId: " b-12345674 ",
      taxCountry: "es",
      verificationStatus: "VERIFIED",
      verifiedAt: "2026-01-01T00:00:00Z",
      reviewedByUserId: ADMIN,
      revision: 99,
      professionalProfileId: PROFILE_B,
      userId: "user-b",
      id: PROFILE_B,
    });
    expect(parsed.taxId).toBe("B12345674");
    expect(parsed.taxCountry).toBe("ES");
    expect(Object.keys(parsed).sort()).toEqual([...MATERIAL_BILLING_FIELDS].sort());
    expect(JSON.stringify(parsed)).not.toMatch(/VERIFIED|reviewedByUserId|revision|professionalProfileId|userId/);
  });

  it.each([
    ["taxId", "!!"],
    ["taxId", "AB"],
    ["taxCountry", "ESP"],
    ["country", "E"],
    ["legalName", ""],
    ["postalCode", "<b>"],
    ["entityType", "PARTNERSHIP"],
  ])("rejects an invalid %s (%j)", (field, value) => {
    expect(saveBillingIdentitySchema.safeParse({ ...VALID_BILLING_INPUT, [field]: value }).success).toBe(false);
  });

  it("uses validation keys, never prose, for the billing-specific messages", () => {
    const result = saveBillingIdentitySchema.safeParse({ ...VALID_BILLING_INPUT, taxId: "!!", country: "1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("dto.billingIdentity.taxId");
      expect(messages).toContain("dto.billingIdentity.country");
    }
  });

  it("bounds admin inputs", () => {
    expect(rejectBillingIdentitySchema.safeParse({ identityId: PROFILE_A, expectedRevision: 1, reason: "NOPE" }).success).toBe(false);
    expect(rejectBillingIdentitySchema.safeParse({ identityId: "x", expectedRevision: 1, reason: "OTHER" }).success).toBe(false);
    expect(rejectBillingIdentitySchema.safeParse({ identityId: PROFILE_A, expectedRevision: 0, reason: "OTHER" }).success).toBe(false);
    expect(listPendingBillingIdentitiesSchema.safeParse({ limit: 1000 }).success).toBe(false);
  });
});

describe("M146 professional flow — authority and ownership", () => {
  it("a new submission is UNVERIFIED (pending review), never verified", async () => {
    const { save, identities } = setup();
    const view = await save.execute("user-a", parse());
    expect(view.state).toBe("PENDING_REVIEW");
    expect(view.verifiedAt).toBeNull();
    expect(firstRow(identities).verificationStatus).toBe("UNVERIFIED");
  });

  it("the use case has no way to accept a status: extra keys on its input are ignored", async () => {
    const { save, identities } = setup();
    const hostile = { ...parse(), verificationStatus: "VERIFIED", verifiedAt: new Date(), revision: 50 } as unknown as SaveBillingIdentityInput;
    const view = await save.execute("user-a", hostile);
    expect(view.state).toBe("PENDING_REVIEW");
    const row = firstRow(identities);
    expect(row.verificationStatus).toBe("UNVERIFIED");
    expect(row.verifiedAt).toBeNull();
    expect(row.revision).toBe(1);
  });

  it("re-validates in the domain even when the DTO schema was skipped", async () => {
    const { save } = setup();
    await expect(save.execute("user-a", { ...VALID_BILLING_INPUT, taxId: "!!" } as unknown as SaveBillingIdentityInput)).rejects.toBeInstanceOf(ValidationError);
  });

  it("scopes every read and write to the session user's own profile", async () => {
    const { save, get, identities } = setup();
    await save.execute("user-a", parse({ legalName: "A Company S.L." }));
    await save.execute("user-b", parse({ legalName: "B Company S.L.", taxId: "B87654321" }));

    expect((await get.execute("user-a")).details?.legalName).toBe("A Company S.L.");
    expect((await get.execute("user-b")).details?.legalName).toBe("B Company S.L.");
    expect([...identities.rows.values()].map((r) => r.professionalProfileId).sort()).toEqual([PROFILE_A, PROFILE_B]);
  });

  it("B editing never changes A's identity, even if B sends A's ids", async () => {
    const { save, identities } = setup();
    await save.execute("user-a", parse({ legalName: "A Company S.L." }));
    const hostile = { ...parse({ legalName: "Hijacked" }), professionalProfileId: PROFILE_A, userId: "user-a" } as unknown as SaveBillingIdentityInput;
    await save.execute("user-b", hostile);
    const a = await identities.findByProfessionalProfileId(PROFILE_A);
    expect(a?.legalName).toBe("A Company S.L.");
    expect((await identities.findByProfessionalProfileId(PROFILE_B))?.legalName).toBe("Hijacked");
  });

  it("a user without a professional profile gets NotFound for read and write", async () => {
    const { save, get } = setup();
    await expect(save.execute("nobody", parse())).rejects.toBeInstanceOf(NotFoundError);
    await expect(get.execute("nobody")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a professional with no billing identity reads MISSING (not an error)", async () => {
    const { get } = setup();
    expect(await get.execute("user-a")).toEqual({ state: "MISSING", details: null, rejectionReason: null, verifiedAt: null });
  });

  it("never touches the M98 professional verification state", async () => {
    // professionalsFake() throws on anything except findByUserId; user-a is M98-VERIFIED, user-b is not.
    const { save, verify, identities } = setup();
    await save.execute("user-a", parse());
    await save.execute("user-b", parse({ taxId: "B87654321" }));
    const a = await identities.findByProfessionalProfileId(PROFILE_A);
    await verify.execute(ADMIN, { identityId: a!.id, expectedRevision: a!.revision });
    // The M98-VERIFIED professional's billing identity was still pending until an admin acted,
    // and the M98-UNVERIFIED one can hold a pending billing identity independently.
    expect((await identities.findByProfessionalProfileId(PROFILE_B))?.verificationStatus).toBe("UNVERIFIED");
  });
});

describe("M146 verification authority and invalidation", () => {
  async function verified() {
    const ctx = setup();
    await ctx.save.execute("user-a", parse());
    const row = firstRow(ctx.identities);
    await ctx.verify.execute(ADMIN, { identityId: row.id, expectedRevision: row.revision });
    return { ...ctx, id: row.id };
  }

  it("an administrator decision verifies exactly the reviewed revision", async () => {
    const { identities, id } = await verified();
    const row = (await identities.findById(id))!;
    expect(row.verificationStatus).toBe("VERIFIED");
    expect(row.verifiedAt).not.toBeNull();
    expect(row.reviewedByUserId).toBe(ADMIN);
  });

  it("re-saving identical details keeps the verification", async () => {
    const { save, get } = await verified();
    expect((await save.execute("user-a", parse())).state).toBe("VERIFIED");
    expect((await get.execute("user-a")).state).toBe("VERIFIED");
  });

  it("normalisation-equivalent input is not a change (spacing/case of the tax id)", async () => {
    const { save } = await verified();
    expect((await save.execute("user-a", parse({ taxId: " b 12345674 ", taxCountry: "es" }))).state).toBe("VERIFIED");
  });

  it.each([
    ["entityType", { entityType: "INDIVIDUAL" }],
    ["legalName", { legalName: "Another Name S.L." }],
    ["taxId", { taxId: "B87654321" }],
    ["taxCountry", { taxCountry: "PT" }],
    ["addressLine1", { addressLine1: "New Street 5" }],
    ["addressLine2", { addressLine2: "Floor 3" }],
    ["city", { city: "Valencia" }],
    ["region", { region: "" }],
    ["postalCode", { postalCode: "46001" }],
    ["country", { country: "PT" }],
  ])("changing %s invalidates a previous verification", async (_field, patch) => {
    const { save, identities, id } = await verified();
    const view = await save.execute("user-a", parse(patch));
    expect(view.state).toBe("PENDING_REVIEW");
    expect(view.verifiedAt).toBeNull();
    const row = (await identities.findById(id))!;
    expect(row.verificationStatus).toBe("UNVERIFIED");
    expect(row.verifiedAt).toBeNull();
    expect(row.reviewedByUserId).toBeNull();
    expect(row.revision).toBe(2);
  });

  it("editing a rejected identity sends it back to review and clears the rejection", async () => {
    const { save, reject, identities } = setup();
    await save.execute("user-a", parse());
    const row = firstRow(identities);
    await reject.execute(ADMIN, { identityId: row.id, expectedRevision: 1, reason: "TAX_ID_MISMATCH", note: "internal" });
    expect((await identities.findById(row.id))?.verificationStatus).toBe("REJECTED");
    const view = await save.execute("user-a", parse({ taxId: "B87654321" }));
    expect(view.state).toBe("PENDING_REVIEW");
    expect(view.rejectionReason).toBeNull();
    expect((await identities.findById(row.id))?.reviewNote).toBeNull();
  });

  it("a stale decision cannot verify content edited after review (revision-bound)", async () => {
    const { save, verify, identities } = setup();
    await save.execute("user-a", parse());
    const reviewed = firstRow(identities);
    await save.execute("user-a", parse({ legalName: "Edited After Review S.L." }));
    await expect(verify.execute(ADMIN, { identityId: reviewed.id, expectedRevision: reviewed.revision })).rejects.toBeInstanceOf(ConflictError);
    expect((await identities.findById(reviewed.id))?.verificationStatus).toBe("UNVERIFIED");
  });

  it("verification is not repeatable or applicable to rejected rows", async () => {
    const { verify, reject, identities, id } = await verified();
    const row = (await identities.findById(id))!;
    await expect(verify.execute(ADMIN, { identityId: id, expectedRevision: row.revision })).rejects.toBeInstanceOf(ConflictError);
    await reject.execute(ADMIN, { identityId: id, expectedRevision: row.revision, reason: "OTHER", note: null });
    await expect(verify.execute(ADMIN, { identityId: id, expectedRevision: row.revision })).rejects.toBeInstanceOf(ConflictError);
  });

  it("an administrator can revoke a verified identity", async () => {
    const { reject, identities, id } = await verified();
    await reject.execute(ADMIN, { identityId: id, expectedRevision: 1, reason: "ADDRESS_INVALID", note: null });
    const row = (await identities.findById(id))!;
    expect(row.verificationStatus).toBe("REJECTED");
    expect(row.verifiedAt).toBeNull();
  });

  it("refuses to verify an incomplete stored row and an unknown id", async () => {
    const { verify, identities } = setup();
    const { record } = await identities.saveDetails(PROFILE_A, { ...parse(), taxId: "" });
    await expect(verify.execute(ADMIN, { identityId: record.id, expectedRevision: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(verify.execute(ADMIN, { identityId: PROFILE_B, expectedRevision: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(verify.execute("", { identityId: record.id, expectedRevision: 1 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("records audit entries with ids and codes only (no tax id, name, address or note)", async () => {
    const { save, verify, reject, audit, identities } = setup();
    await save.execute("user-a", parse());
    const row = firstRow(identities);
    await reject.execute(ADMIN, { identityId: row.id, expectedRevision: 1, reason: "OTHER", note: "SECRET INTERNAL NOTE" });
    await save.execute("user-a", parse({ legalName: "Second Version S.L." }));
    await verify.execute(ADMIN, { identityId: row.id, expectedRevision: 2 });

    expect(audit.entries.map((e) => e.action)).toEqual(["BILLING_IDENTITY_SUBMITTED", "BILLING_IDENTITY_REJECTED", "BILLING_IDENTITY_SUBMITTED", "BILLING_IDENTITY_VERIFIED"]);
    const serialised = JSON.stringify(audit.entries);
    for (const forbidden of ["B12345674", "Fontanería", "Second Version", "Carrer Major", "Gandia", "46700", "SECRET INTERNAL NOTE"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("an audit failure never fails or rolls back the decision", async () => {
    const identities = new FakeProfessionalBillingIdentityRepository();
    const failing: AdminAuditLogRepository = { record: async () => { throw new Error("audit down"); }, list: async () => [] };
    const reported: unknown[] = [];
    const save = new SaveMyBillingIdentityUseCase(professionalsFake(), identities, failing, { report: (e: unknown) => void reported.push(e) });
    await expect(save.execute("user-a", parse())).resolves.toMatchObject({ state: "PENDING_REVIEW" });
    expect(reported).toHaveLength(1);
  });
});

describe("M146 safe DTO projection", () => {
  it("the professional view never carries ids, revision, reviewer, note or review timestamps", async () => {
    const { save, reject, get, identities } = setup();
    await save.execute("user-a", parse());
    const row = firstRow(identities);
    await reject.execute(ADMIN, { identityId: row.id, expectedRevision: 1, reason: "LEGAL_NAME_MISMATCH", note: "INTERNAL ONLY NOTE" });
    const view = await get.execute("user-a");
    expect(view.state).toBe("NEEDS_CORRECTION");
    expect(view.rejectionReason).toBe("LEGAL_NAME_MISMATCH");
    const json = JSON.stringify(view);
    for (const forbidden of ["INTERNAL ONLY NOTE", ADMIN, row.id, PROFILE_A, "reviewNote", "reviewedByUserId", "reviewedAt", "revision", "professionalProfileId"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(Object.keys(view).sort()).toEqual(["details", "rejectionReason", "state", "verifiedAt"]);
  });

  it("the admin list masks the tax id and omits the address", async () => {
    const { save, identities } = setup();
    await save.execute("user-a", parse());
    const list = await new ListBillingIdentitiesPendingReviewUseCase(identities).execute(ADMIN, { limit: 10 });
    expect(list).toHaveLength(1);
    expect(list[0]!.taxIdMasked).toBe("*****5674");
    const json = JSON.stringify(list);
    expect(json).not.toContain("B12345674");
    expect(json).not.toContain("Carrer Major");
  });

  it("the admin review view exposes the revision a decision must be bound to", async () => {
    const { save, identities } = setup();
    await save.execute("user-a", parse());
    const row = firstRow(identities);
    const view = await new GetBillingIdentityForAdminReviewUseCase(identities).execute(ADMIN, row.id);
    expect(view.revision).toBe(1);
    expect(view.details?.taxId).toBe("B12345674");
  });
});

describe("M146 readiness query for M147/M150", () => {
  it("reports not-ready until verified, ready after, and not-ready again after a change", async () => {
    const { save, verify, identities } = setup();
    const readiness = new GetProfessionalBillingReadinessUseCase(identities);

    expect(await readiness.execute(PROFILE_A)).toMatchObject({ state: "MISSING", billingReady: false, snapshot: null });

    await save.execute("user-a", parse());
    expect(await readiness.execute(PROFILE_A)).toMatchObject({ state: "PENDING_REVIEW", billingReady: false, snapshot: null });

    const row = firstRow(identities);
    await verify.execute(ADMIN, { identityId: row.id, expectedRevision: 1 });
    const ready = await readiness.execute(PROFILE_A);
    expect(ready).toMatchObject({ state: "VERIFIED", billingReady: true });
    expect(ready.snapshot).toMatchObject({ professionalProfileId: PROFILE_A, revision: 1, taxId: "B12345674" });

    await save.execute("user-a", parse({ city: "Valencia" }));
    expect(await readiness.execute(PROFILE_A)).toMatchObject({ state: "PENDING_REVIEW", billingReady: false, snapshot: null });
  });

  it("a professional that is M98-VERIFIED but has no billing identity is not billing-ready", async () => {
    const identities = new FakeProfessionalBillingIdentityRepository();
    expect((await new GetProfessionalBillingReadinessUseCase(identities).execute(PROFILE_A)).billingReady).toBe(false);
  });
});
