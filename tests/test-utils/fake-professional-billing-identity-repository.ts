import { randomUUID } from "node:crypto";

import type {
  BillingIdentityDecision,
  ProfessionalBillingIdentityRecord,
  ProfessionalBillingIdentityRepository,
  SaveBillingIdentityResult,
} from "@/domain/repositories/professional-billing-identity-repository";
import {
  hasMaterialBillingChange,
  type BillingIdentityDetails,
  type BillingIdentityRejectionReason,
} from "@/domain/services/professional-billing-identity";

/**
 * In-memory ProfessionalBillingIdentityRepository mirroring the semantics the real
 * adapter + migration trigger guarantee (reset on material change, revision
 * bump, revision-bound conditional decisions). The real PostgreSQL behaviour is
 * proven separately in tests/integration-db/billing-identity.
 */
export class FakeProfessionalBillingIdentityRepository implements ProfessionalBillingIdentityRepository {
  readonly rows = new Map<string, ProfessionalBillingIdentityRecord>();
  private clock = 0;

  private tick(): Date {
    this.clock += 1;
    return new Date(Date.UTC(2026, 9, 12, 0, 0, this.clock));
  }

  async findByProfessionalProfileId(professionalProfileId: string) {
    return [...this.rows.values()].find((r) => r.professionalProfileId === professionalProfileId) ?? null;
  }

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async saveDetails(professionalProfileId: string, details: BillingIdentityDetails): Promise<SaveBillingIdentityResult> {
    const existing = await this.findByProfessionalProfileId(professionalProfileId);
    const now = this.tick();
    if (!existing) {
      const record: ProfessionalBillingIdentityRecord = {
        id: randomUUID(),
        professionalProfileId,
        ...details,
        verificationStatus: "UNVERIFIED",
        revision: 1,
        verifiedAt: null,
        reviewedAt: null,
        reviewedByUserId: null,
        rejectionReason: null,
        reviewNote: null,
        createdAt: now,
        updatedAt: now,
      };
      this.rows.set(record.id, record);
      return { record: { ...record }, changed: true };
    }
    if (!hasMaterialBillingChange(existing, details)) return { record: { ...existing }, changed: false };
    const updated: ProfessionalBillingIdentityRecord = {
      ...existing,
      ...details,
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      rejectionReason: null,
      reviewNote: null,
      revision: existing.revision + 1,
      updatedAt: now,
    };
    this.rows.set(updated.id, updated);
    return { record: { ...updated }, changed: true };
  }

  async markVerified(id: string, expectedRevision: number, decision: BillingIdentityDecision) {
    const row = this.rows.get(id);
    if (!row || row.revision !== expectedRevision || row.verificationStatus !== "UNVERIFIED") return null;
    const updated: ProfessionalBillingIdentityRecord = {
      ...row,
      verificationStatus: "VERIFIED",
      verifiedAt: decision.now,
      reviewedAt: decision.now,
      reviewedByUserId: decision.adminUserId,
      rejectionReason: null,
      reviewNote: null,
      updatedAt: this.tick(),
    };
    this.rows.set(id, updated);
    return { ...updated };
  }

  async markRejected(
    id: string,
    expectedRevision: number,
    decision: BillingIdentityDecision & { reason: BillingIdentityRejectionReason; note: string | null },
  ) {
    const row = this.rows.get(id);
    if (!row || row.revision !== expectedRevision || row.verificationStatus === "REJECTED") return null;
    const updated: ProfessionalBillingIdentityRecord = {
      ...row,
      verificationStatus: "REJECTED",
      verifiedAt: null,
      reviewedAt: decision.now,
      reviewedByUserId: decision.adminUserId,
      rejectionReason: decision.reason,
      reviewNote: decision.note,
      updatedAt: this.tick(),
    };
    this.rows.set(id, updated);
    return { ...updated };
  }

  async listPendingReview(options: { limit: number; offset: number }) {
    return [...this.rows.values()]
      .filter((r) => r.verificationStatus === "UNVERIFIED")
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }
}

export const VALID_BILLING_INPUT = {
  entityType: "COMPANY",
  legalName: "Fontanería Mediterránea S.L.",
  taxId: "B12345674",
  taxCountry: "ES",
  addressLine1: "Carrer Major 12",
  addressLine2: "",
  city: "Gandia",
  region: "Valencia",
  postalCode: "46700",
  country: "ES",
} as const;
