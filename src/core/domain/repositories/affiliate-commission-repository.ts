/**
 * Module 61 — Affiliate & Partner System: repository interface for
 * `AffiliateCommission` — the ledger row recording that a partner has
 * earned 10% of a specific, already-recorded Module 22 `Commission`.
 *
 * This module NEVER computes or writes to Module 22's `Commission` table
 * (see `domain/services/affiliate-commission-policy.ts`'s own doc comment)
 * — `platformCommissionRefId`/`platformCommissionAmount` are a snapshot of
 * an already-existing `Commission` row, read-only, the same "reference
 * another bounded context's id via a plain string, never a cross-module FK"
 * convention `ConversionEventRecord.referenceId` already establishes (see
 * that repository's own doc comment for the identical reasoning).
 *
 * Idempotency: `conversionEventId` is unique — at most one
 * `AffiliateCommission` is ever recorded per Module 60 `ConversionEvent`
 * (specifically, per `COMMISSION_GENERATED` event), so a webhook/use-case
 * retry can never double-pay a partner for the same booking.
 */
export const AFFILIATE_COMMISSION_STATUS_VALUES = ["PENDING", "APPROVED", "PAID", "CANCELLED", "EXPIRED", "REVERSED"] as const;
export type AffiliateCommissionStatusValue = (typeof AFFILIATE_COMMISSION_STATUS_VALUES)[number];

export interface AffiliateCommissionRecord {
  id: string;
  partnerId: string;
  /** The `ReferralCode.code` that drove the attribution behind this
   *  commission — denormalized (not just the id) so a report/ledger export
   *  never needs a join back to `referral_codes` to be readable. */
  referralCode: string;
  /** Module 60 `ConversionEvent.id` (type `COMMISSION_GENERATED`) this
   *  commission was derived from — the uniqueness anchor for idempotency. */
  conversionEventId: string;
  /** Module 22 `Commission.id` — plain string reference, never a Prisma
   *  relation across module boundaries (see class doc comment). */
  platformCommissionRefId: string;
  /** Snapshot of `Commission.amount` at the time this row was created —
   *  never re-read live, so a later Module 22 correction never silently
   *  changes an already-recorded affiliate ledger entry. */
  platformCommissionAmount: number;
  /** Module 96 — directly attributable transaction cost (Stripe
   *  processing fee, refund/dispute loss) subtracted from
   *  `platformCommissionAmount` to reach `profitBaseAmount`. `0` when no
   *  such cost was known at creation time — see
   *  `affiliate-commission-policy.ts`'s own doc comment. */
  attributableCostAmount: number;
  /** Module 96 — `platformCommissionAmount - attributableCostAmount`,
   *  floored at 0. The actual base `affiliateAmount` was computed from —
   *  persisted so a later reader never has to recompute it. */
  profitBaseAmount: number;
  /** Basis points actually applied — snapshotted the same way
   *  `CommissionRecord.rateBps` is, so a future rate change never
   *  retroactively changes what an already-recorded row says it paid. */
  affiliateRateBps: number;
  affiliateAmount: number;
  /** Module 96 — cumulative sum of every reversal applied against this
   *  row (see `AffiliateCommissionReversalRepository`). Net payable
   *  balance is always `affiliateAmount - reversedAmount`, computed by
   *  the reader — never its own separately-trusted field. `0` for a
   *  commission with no reversal history. */
  reversedAmount: number;
  /** Module 96 Financial Integrity Hardening Pass — see schema.prisma's
   *  own doc comment on this column. Non-null means this commission's
   *  fee never arrived within the bounded finalization window and it is
   *  now excluded from payout eligibility (`listApprovedForPartner`)
   *  until a human clears it. */
  costFinalizationFailedAt: Date | null;
  status: AffiliateCommissionStatusValue;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  expiresAt: Date;
  expiredAt: Date | null;
  paidAt: Date | null;
  payoutId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAffiliateCommissionData {
  partnerId: string;
  referralCode: string;
  conversionEventId: string;
  platformCommissionRefId: string;
  platformCommissionAmount: number;
  /** See `AffiliateCommissionRecord.attributableCostAmount`'s own doc
   *  comment. */
  attributableCostAmount: number;
  /** See `AffiliateCommissionRecord.profitBaseAmount`'s own doc comment. */
  profitBaseAmount: number;
  affiliateRateBps: number;
  affiliateAmount: number;
  expiresAt: Date;
}

export interface AffiliateEarningsTotals {
  pendingTotal: number;
  approvedTotal: number;
  paidTotal: number;
}

export interface AffiliateCommissionRepository {
  create(data: CreateAffiliateCommissionData): Promise<AffiliateCommissionRecord>;
  findById(id: string): Promise<AffiliateCommissionRecord | null>;
  /** Idempotency lookup — see class doc comment. */
  findByConversionEventId(conversionEventId: string): Promise<AffiliateCommissionRecord | null>;
  /** Module 96 — resolves a Module 22 `Commission.id` back to the
   *  `AffiliateCommission` derived from it, if any. `platformCommissionRefId`
   *  carries no DB-level uniqueness of its own, but is 1:1 with an
   *  `AffiliateCommission` in practice — each commission is created from
   *  exactly one `COMMISSION_GENERATED` conversion event, and that
   *  event's own `(type, referenceId)` DB uniqueness (see
   *  schema.prisma's `ConversionEvent` doc comment) already prevents more
   *  than one from ever existing for the same Commission. Used by the
   *  refund/chargeback reversal path, which only ever knows the
   *  Commission (via `Payment.id` -> `Commission`), never the
   *  `AffiliateCommission` directly. */
  findByPlatformCommissionRefId(platformCommissionRefId: string): Promise<AffiliateCommissionRecord | null>;
  listForPartner(partnerId: string, filter?: { status?: AffiliateCommissionStatusValue }): Promise<AffiliateCommissionRecord[]>;
  /** Every row still `PENDING` whose `expiresAt` is at or before `asOf` —
   *  feeds `ExpireAffiliateCommissionsUseCase`'s batch sweep. */
  listExpirable(asOf: Date): Promise<AffiliateCommissionRecord[]>;
  /** Every `APPROVED` row for a partner NOT already claimed by another
   *  in-flight payout (`payoutId IS NULL`), oldest first — the exact set
   *  `CreatePartnerPayoutUseCase` selects from (see
   *  `domain/services/partner-payout-rules.ts`). Module 96 Financial Fix
   *  Pass: the `payoutId IS NULL` filter is what stops a second
   *  concurrent payout attempt from selecting a commission an
   *  in-progress payout has already claimed — see
   *  `CreatePartnerPayoutUseCase`'s own doc comment on the claim-then-
   *  pay transaction this filter is the read-side half of. */
  listApprovedForPartner(partnerId: string): Promise<AffiliateCommissionRecord[]>;
  updateStatus(
    id: string,
    data: {
      status: AffiliateCommissionStatusValue;
      approvedAt?: Date | null;
      cancelledAt?: Date | null;
      cancelReason?: string | null;
      expiredAt?: Date | null;
      paidAt?: Date | null;
      payoutId?: string | null;
    },
  ): Promise<AffiliateCommissionRecord>;
  /**
   * Module 96 — persists the cumulative effect of a reversal: the new
   * running `reversedAmount` total (never a delta — the caller computes
   * `previousReversedAmount + thisReversal`) and, when the net balance
   * has reached 0, the transition to `REVERSED` (skipped if the
   * commission had already reached `PAID` — see
   * `AffiliateCommissionStatus.REVERSED`'s own schema doc comment on why
   * a `PAID` row stays `PAID`). Never touches `affiliateAmount`/
   * `profitBaseAmount` — those are immutable once created (see this
   * file's own doc comment); the reversal ledger row itself
   * (`AffiliateCommissionReversalRepository`) is the append-only record
   * of what happened and why.
   */
  recordReversal(id: string, data: { reversedAmount: number; status?: AffiliateCommissionStatusValue }): Promise<AffiliateCommissionRecord>;
  /** Marks every commission in `ids` PAID and stamps `payoutId` — used by
   *  `CreatePartnerPayoutUseCase` to settle a whole payout batch
   *  atomically-in-intent (the Prisma implementation wraps this in a single
   *  `updateMany`, not `ids.length` sequential round trips). */
  markPaidByIds(ids: string[], payoutId: string, paidAt: Date): Promise<void>;
  /**
   * Module 96 Financial Integrity Hardening Pass — Risk 2 recovery
   * counterpart to `markPaidByIds`: marks every commission already
   * CLAIMED by `payoutId` (i.e. `payoutId = <this payout>`) PAID, but
   * ONLY those still `APPROVED` — an idempotent `updateMany`, safe to
   * call after a Stripe transfer is confirmed to have actually
   * succeeded for a payout whose commission ids are not otherwise known
   * to the caller (the crash-recovery path only ever has the stuck
   * `PartnerPayout.id`, never the original batch's commission id list —
   * see `ReconcileStuckPartnerPayoutUseCase`'s own doc comment). A
   * repeat call for a payout whose commissions are already PAID is a
   * pure no-op (`status = 'APPROVED'` matches nothing).
   */
  markPaidByPayoutId(payoutId: string, paidAt: Date): Promise<void>;
  totalsForPartner(partnerId: string): Promise<AffiliateEarningsTotals>;
  /**
   * Module 96 Financial Fix Pass — the maintenance sweep's backstop for
   * `ReconcileAffiliateCommissionStripeFeeUseCase`: every commission
   * still `PENDING` or `APPROVED` with `attributableCostAmount = 0`,
   * oldest first, capped at `limit`. This is a best-effort, harmless-to-
   * re-run candidate list, not itself the idempotency guard (the
   * reversal ledger's unique `financialAdjustmentId` constraint is) — a
   * commission that genuinely has a real $0 fee, or whose fee has
   * already been reconciled, is safely re-selected and re-checked on
   * every sweep with zero effect.
   */
  listPendingFeeReconciliation(limit: number): Promise<AffiliateCommissionRecord[]>;
  /**
   * Module 96 Financial Integrity Hardening Pass — Risk 3: every
   * commission still `PENDING`/`APPROVED` with `attributableCostAmount =
   * 0` AND `createdAt <= cutoff` AND not already flagged
   * (`costFinalizationFailedAt IS NULL`) — the candidate set for
   * `FinalizeOverdueAffiliateCommissionFeesUseCase`'s bounded-window
   * enforcement. `listPendingFeeReconciliation` ALSO excludes
   * `costFinalizationFailedAt`-flagged rows (see that method's own
   * comment), so once a commission is flagged here, the reconciliation
   * backstop stops retrying it — the flag is the terminal outcome, not
   * one more thing being raced against.
   */
  listFeeFinalizationOverdue(cutoff: Date, limit: number): Promise<AffiliateCommissionRecord[]>;
  /**
   * Module 96 Financial Integrity Hardening Pass — Risk 3: stamps
   * `costFinalizationFailedAt`. Idempotent in effect (re-stamping an
   * already-flagged row with a new timestamp is harmless — the field is
   * only ever read as "is this null or not," see
   * `listApprovedForPartner`'s own doc comment on the payout-eligibility
   * gate this enables), but callers should prefer to skip a row that
   * `findById` already shows as flagged rather than re-stamp it, purely
   * to keep the audit trail's timestamp meaningful.
   */
  markCostFinalizationFailed(id: string, at: Date): Promise<AffiliateCommissionRecord>;
  /**
   * Module 96 Financial Fix Pass — releases every commission
   * provisionally claimed (`payoutId` set) for `payoutId` back to
   * unclaimed (`payoutId = null`), but ONLY while still `APPROVED` —
   * never touches one that has already reached `PAID` (a payout that
   * fails after some commissions were already marked paid, if that were
   * ever possible, must never silently un-pay them). Used by
   * `CreatePartnerPayoutUseCase` when a claimed batch's Stripe transfer
   * fails, so those commissions become selectable by a future payout
   * attempt instead of being permanently stranded — see that use case's
   * own doc comment on "a failed payout stays retryable."
   */
  releaseClaimedCommissions(payoutId: string): Promise<void>;
  /**
   * Module 96 Financial Integrity Hardening Pass — the atomicity fix for
   * the read-then-write race on `reversedAmount`: a refund reversal and
   * a Stripe-fee correction (or two of either, or two concurrent
   * webhook redeliveries) used to each read `reversedAmount`, compute a
   * new absolute value in application code, and write it back — a
   * classic lost-update race under concurrency.
   *
   * This method instead: (1) fast-path idempotency — if
   * `financialAdjustmentId` already has a recorded reversal, returns the
   * commission unchanged with no lock taken at all; (2) otherwise takes
   * a row lock (`SELECT ... FOR UPDATE`) on this ONE commission inside a
   * transaction, serializing every concurrent reversal attempt against
   * it (refund, dispute, or fee-correction — all go through this same
   * method, so mixing types is automatically safe); (3) invokes `decide`
   * with the freshly-locked, up-to-date `{affiliateAmount, reversedAmount,
   * status}` — never a value read before the lock — to get the amount to
   * apply; (4) inserts the append-only `AffiliateCommissionReversal` row;
   * (5) recomputes `reversedAmount` as the SUM of every reversal row for
   * this commission (never an application-side increment) so the stored
   * total is always, by construction, exactly the sum of the ledger —
   * self-healing against any drift; (6) derives the FULL/PARTIAL type and
   * the PAID-stays-PAID / REVERSED status transition from that fresh sum.
   *
   * `decide` is a pure function (no I/O) — the caller's existing
   * `calculateAffiliateCommissionReversal`/`calculateAffiliateCommissionFeeCorrection`
   * domain functions, closed over the caller's own input — injected here
   * only because the correct amount genuinely cannot be computed before
   * the lock is held without reintroducing the exact race this method
   * exists to close. Returning `null` from `decide` (or a `<= 0` amount)
   * is a deliberate no-op — the commission is returned unchanged, no
   * transaction side effects at all.
   */
  applyReversalAtomically(
    affiliateCommissionId: string,
    financialAdjustmentId: string,
    decide: (current: {
      affiliateAmount: number;
      reversedAmount: number;
      status: AffiliateCommissionStatusValue;
    }) => { amount: number; reason: string | null } | null,
  ): Promise<AffiliateCommissionRecord | null>;
}
