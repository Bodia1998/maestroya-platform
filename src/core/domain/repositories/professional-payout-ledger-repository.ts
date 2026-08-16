/**
 * Module 69 — Financial Ledger & Payout Readiness Audit: a narrow,
 * read-only seam over the existing `Payout` model (already used today only
 * by `PrismaFinancialReportingRepository.getPlatformRevenueAggregate`'s
 * `payoutsTotal` figure) for the ONE additional read `CheckPayoutReadinessUseCase`
 * needs: how much has already actually been paid out to a specific
 * professional. Kept separate from `CommissionRepository`/`PaymentRepository`/
 * `FinancialLedgerRepository` for the same reason `FinancialReportingRepository`
 * itself is kept separate — a single-purpose aggregate seam, not a general
 * Payout write/read API (no real payout provider exists yet to ever create a
 * `Payout` row; this module does not add one — see the module's "NO STRIPE
 * IN MODULE 69" restriction).
 */
export interface ProfessionalPayoutLedgerRepository {
  /** Sum of `Payout.amount` for every `PAID` Payout belonging to this
   *  professional (by `professionalProfileId`). Always `0` today — no
   *  writer of `Payout` exists yet — but the read path exists so
   *  `CheckPayoutReadinessUseCase`'s `amountAlreadyPaidOut` input is always
   *  sourced from the real table, never hardcoded to `0`, and Module 70
   *  needs no code change here once a real payout provider starts writing
   *  `PAID` rows. */
  sumPaidForProfessional(professionalProfileId: string): Promise<number>;
}
