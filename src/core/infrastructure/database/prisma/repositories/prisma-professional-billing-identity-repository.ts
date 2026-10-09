import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  BillingIdentityDecision,
  ProfessionalBillingIdentityRecord,
  ProfessionalBillingIdentityRepository,
  SaveBillingIdentityResult,
} from "@/domain/repositories/professional-billing-identity-repository";
import {
  hasMaterialBillingChange,
  type BillingEntityType,
  type BillingIdentityDetails,
  type BillingIdentityPersistedStatus,
  type BillingIdentityRejectionReason,
} from "@/domain/services/professional-billing-identity";

type Row = {
  id: string;
  professionalProfileId: string;
  entityType: string;
  legalName: string;
  taxId: string;
  taxCountry: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  country: string;
  verificationStatus: string;
  revision: number;
  verifiedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): ProfessionalBillingIdentityRecord {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    entityType: row.entityType as BillingEntityType,
    legalName: row.legalName,
    taxId: row.taxId,
    taxCountry: row.taxCountry,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    verificationStatus: row.verificationStatus as BillingIdentityPersistedStatus,
    revision: row.revision,
    verifiedAt: row.verifiedAt,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId,
    rejectionReason: row.rejectionReason as BillingIdentityRejectionReason | null,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function detailsOf(row: BillingIdentityDetails): BillingIdentityDetails {
  return {
    entityType: row.entityType,
    legalName: row.legalName,
    taxId: row.taxId,
    taxCountry: row.taxCountry,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
  };
}

/** Review metadata that must be cleared whenever the reviewed content changes. */
const CLEARED_REVIEW = {
  verificationStatus: "UNVERIFIED",
  verifiedAt: null,
  reviewedAt: null,
  reviewedByUserId: null,
  rejectionReason: null,
  reviewNote: null,
} as const;

/**
 * Module 146. `saveDetails` is the only write the professional-facing flow can
 * reach and it has no status parameter at all. A material change both resets the
 * row here and is re-enforced by the `professional_billing_identity_guard`
 * trigger (migration), so raw SQL cannot keep VERIFIED across an edit either.
 */
export class PrismaProfessionalBillingIdentityRepository implements ProfessionalBillingIdentityRepository {
  async findByProfessionalProfileId(professionalProfileId: string): Promise<ProfessionalBillingIdentityRecord | null> {
    const row = await prisma.professionalBillingIdentity.findUnique({ where: { professionalProfileId } });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<ProfessionalBillingIdentityRecord | null> {
    const row = await prisma.professionalBillingIdentity.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async saveDetails(professionalProfileId: string, details: BillingIdentityDetails): Promise<SaveBillingIdentityResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.professionalBillingIdentity.findUnique({ where: { professionalProfileId } });
          if (!existing) {
            const created = await tx.professionalBillingIdentity.create({
              data: { professionalProfileId, ...details, verificationStatus: "UNVERIFIED" },
            });
            return { record: toRecord(created), changed: true };
          }
          if (!hasMaterialBillingChange(detailsOf(existing as unknown as BillingIdentityDetails), details)) {
            return { record: toRecord(existing), changed: false };
          }
          const updated = await tx.professionalBillingIdentity.update({
            where: { id: existing.id },
            data: { ...details, ...CLEARED_REVIEW, revision: { increment: 1 } },
          });
          return { record: toRecord(updated), changed: true };
        });
      } catch (error) {
        // Two concurrent first saves: the loser hits the unique(professionalProfileId) and retries as an update.
        if (attempt === 0 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
    throw new Error("unreachable");
  }

  async markVerified(id: string, expectedRevision: number, decision: BillingIdentityDecision): Promise<ProfessionalBillingIdentityRecord | null> {
    const result = await prisma.professionalBillingIdentity.updateMany({
      where: { id, revision: expectedRevision, verificationStatus: "UNVERIFIED" },
      data: {
        verificationStatus: "VERIFIED",
        verifiedAt: decision.now,
        reviewedAt: decision.now,
        reviewedByUserId: decision.adminUserId,
        rejectionReason: null,
        reviewNote: null,
      },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async markRejected(
    id: string,
    expectedRevision: number,
    decision: BillingIdentityDecision & { reason: BillingIdentityRejectionReason; note: string | null },
  ): Promise<ProfessionalBillingIdentityRecord | null> {
    const result = await prisma.professionalBillingIdentity.updateMany({
      where: { id, revision: expectedRevision, verificationStatus: { in: ["UNVERIFIED", "VERIFIED"] } },
      data: {
        verificationStatus: "REJECTED",
        verifiedAt: null,
        reviewedAt: decision.now,
        reviewedByUserId: decision.adminUserId,
        rejectionReason: decision.reason,
        reviewNote: decision.note,
      },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async listPendingReview(options: { limit: number; offset: number }): Promise<ProfessionalBillingIdentityRecord[]> {
    const rows = await prisma.professionalBillingIdentity.findMany({
      where: { verificationStatus: "UNVERIFIED" },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }
}
