/**
 * Module 22 — Commission & Financial: repository interface for the
 * existing, previously-unused `Commission` model (see schema.prisma's own
 * doc comment). One row per captured Payment (1:1, `paymentId` unique) —
 * this module never creates more than one Commission for the same
 * Payment; a correction after the fact is a COMMISSION_REVERSAL ledger
 * entry (see financial-ledger-repository.ts) plus a FinancialAdjustment,
 * never a second Commission row or a mutation of this one.
 */

export type CommissionStatusValue = "PENDING" | "INVOICED" | "SETTLED" | "WAIVED";

export interface CommissionRecord {
  id: string;
  paymentId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  /** Basis points actually applied — snapshotted at creation time so a
   *  later platform-wide rate change never retroactively changes what an
   *  already-recorded Commission says it charged. */
  rateBps: number;
  amount: number;
  status: CommissionStatusValue;
  settledAt: Date | null;
  createdAt: Date;
}

export interface CreateCommissionData {
  paymentId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  rateBps: number;
  amount: number;
}

export interface CommissionRepository {
  findByPaymentId(paymentId: string): Promise<CommissionRecord | null>;
  create(data: CreateCommissionData): Promise<CommissionRecord>;
  /** Professional/company-facing earnings listing — see
   *  GetProfessionalEarningsUseCase. Scoped to exactly one
   *  professionalProfileId; never returns another professional's rows. */
  listForProfessional(professionalProfileId: string): Promise<CommissionRecord[]>;
  listForCompany(companyProfileId: string): Promise<CommissionRecord[]>;
}
