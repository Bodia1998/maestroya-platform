import type { PartnerPayoutMethodValue } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: repository interface for
 * `PartnerPayout` — one row per batch of `AffiliateCommission`s settled
 * together for a partner. `method` is always `MANUAL` today; `STRIPE` is
 * modeled in the enum/schema now purely so the architecture doesn't need a
 * migration later, but no Stripe SDK call happens anywhere in this module
 * — see docs/MODULE_61's "Future Stripe support" section.
 */
export const PARTNER_PAYOUT_STATUS_VALUES = ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED"] as const;
export type PartnerPayoutStatusValue = (typeof PARTNER_PAYOUT_STATUS_VALUES)[number];

export interface PartnerPayoutRecord {
  id: string;
  partnerId: string;
  amount: number;
  currency: string;
  method: PartnerPayoutMethodValue;
  status: PartnerPayoutStatusValue;
  /** External reference (e.g. a bank transfer reference today, a future
   *  Stripe transfer id) — opaque to this module, never parsed. */
  reference: string | null;
  periodStart: Date;
  periodEnd: Date;
  processedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerPayoutData {
  partnerId: string;
  amount: number;
  currency?: string;
  method: PartnerPayoutMethodValue;
  periodStart: Date;
  periodEnd: Date;
}

export interface PartnerPayoutRepository {
  create(data: CreatePartnerPayoutData): Promise<PartnerPayoutRecord>;
  /**
   * Module 96 Financial Fix Pass — the database-level fix for
   * `CreatePartnerPayoutUseCase`'s former check-then-create race: inserts
   * the `PartnerPayout` row AND atomically claims (`payoutId = <new
   * payout's id>`) exactly `commissionIds` in the SAME transaction.
   *
   * Two DB-level guarantees, not application logic:
   *  1. A partial unique index on `partner_payouts(partnerId)` (rows with
   *     `status IN ('PENDING','PROCESSING')` only — see the migration)
   *     means a second concurrent call for a partner that already has an
   *     in-flight payout fails the INSERT itself with a Postgres unique-
   *     violation (P2002) — translated to `ConflictError` here.
   *  2. The commission claim is a conditional `updateMany` — `WHERE id
   *     IN (commissionIds) AND payoutId IS NULL AND status = 'APPROVED'`
   *     — whose affected-row count is checked against
   *     `commissionIds.length`; any mismatch (a commission another
   *     concurrent payout already claimed, or one that changed status
   *     between selection and claim) throws `ConflictError` and the
   *     whole transaction — including the just-inserted payout row —
   *     rolls back. A commission can therefore never end up claimed by
   *     two payouts, and a payout is never created for a batch it failed
   *     to fully claim.
   *
   * Throws `ConflictError` on either failure — `CreatePartnerPayoutUseCase`
   * translates that into the same partner-facing `ValidationError`
   * message the old check-then-create path used, so callers observe no
   * behavior change on the happy path, only on the race it now closes.
   */
  createBatch(data: CreatePartnerPayoutData, commissionIds: string[]): Promise<PartnerPayoutRecord>;
  findById(id: string): Promise<PartnerPayoutRecord | null>;
  /**
   * Module 96 Financial Integrity Hardening Pass — Risk 2 recovery: every
   * payout still `PROCESSING` whose `updatedAt` is older than
   * `olderThan`, oldest first, capped at `limit`. Feeds the maintenance
   * sweep's crash-recovery backstop for "Stripe transfer succeeded but
   * the process died before the DB was updated to PAID" — see
   * `ReconcileStuckPartnerPayoutUseCase`'s own doc comment. A payout
   * genuinely still mid-flight (a slow-but-live Stripe call) is
   * indistinguishable from a crashed one from the DB's point of view,
   * which is exactly why the recovery path re-uses the SAME Stripe
   * idempotency key rather than assuming failure.
   */
  listStuckProcessing(olderThan: Date, limit: number): Promise<PartnerPayoutRecord[]>;
  listForPartner(partnerId: string): Promise<PartnerPayoutRecord[]>;
  updateStatus(
    id: string,
    data: { status: PartnerPayoutStatusValue; reference?: string | null; processedAt?: Date | null; failureReason?: string | null },
  ): Promise<PartnerPayoutRecord>;
}
