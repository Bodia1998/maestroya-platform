import type {
  PayoutAccountStatusValue,
  PayoutMethodValue,
  StripeExpressReadinessValue,
} from "@/domain/services/professional-onboarding-rules";

/**
 * Module 75 — Company Payout Eligibility.
 *
 * Repository interface for `CompanyPayoutAccount` — the company-owned
 * mirror of `ProfessionalOnboardingRepository`'s payout-account slice
 * (Module 62/71). Deliberately narrow and standalone (not folded into
 * `CompanyRepository` or `CompanyVerificationRepository`) — same "one
 * repository per aggregate, module-scoped" convention every other payout/
 * verification repository in this codebase already follows.
 *
 * Reuses `PayoutMethodValue`/`PayoutAccountStatusValue`/
 * `StripeExpressReadinessValue` from `professional-onboarding-rules.ts`
 * rather than introducing parallel company-specific enums — a company's
 * payout account is the exact same kind of "thing" (IBAN or Stripe
 * Express destination, in one of PENDING/VERIFIED/REJECTED) a
 * professional's is; only the owner type differs. See
 * `CompanyPayoutAccount`'s own doc comment in schema.prisma for the full
 * rationale.
 */

export interface CompanyPayoutAccountRecord {
  id: string;
  companyProfileId: string;
  method: PayoutMethodValue;
  status: PayoutAccountStatusValue;
  accountHolderName: string;
  /** Last 4 characters only — see `maskIban`
   *  (`professional-onboarding-rules.ts`). `null` for a non-IBAN method. */
  ibanLast4: string | null;
  /** Keyed hash of the full IBAN — duplicate-account detection only,
   *  never reversible back to the original IBAN. `null` for a non-IBAN
   *  method. */
  ibanHash: string | null;
  /** Stripe Connect Express account id (`acct_...`). `null` until a
   *  future module actually creates the real account — this module never
   *  calls the Stripe SDK (see the module's own "out of scope" rule). */
  stripeExpressAccountId: string | null;
  stripeExpressStatus: StripeExpressReadinessValue;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeRequirementsCurrentlyDue: boolean;
  stripeConnectSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyPayoutAccountData {
  companyProfileId: string;
  method: PayoutMethodValue;
  status: PayoutAccountStatusValue;
  accountHolderName: string;
  ibanLast4?: string | null;
  ibanHash?: string | null;
  stripeExpressStatus?: StripeExpressReadinessValue;
}

export interface UpdateCompanyStripeConnectAccountData {
  stripeExpressAccountId?: string;
  stripeExpressStatus?: StripeExpressReadinessValue;
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
  stripeDetailsSubmitted?: boolean;
  stripeRequirementsCurrentlyDue?: boolean;
  stripeConnectSyncedAt?: Date;
}

export interface CompanyPayoutAccountRepository {
  findByCompanyProfileId(companyProfileId: string): Promise<CompanyPayoutAccountRecord | null>;

  /** Module 75 — Stripe-side lookup, the shape a future webhook handler
   *  needs (mirrors `ProfessionalOnboardingRepository
   *  .findPayoutAccountByStripeAccountId` exactly). Unused by this
   *  module's own use cases today — added now so a future Stripe-sync
   *  module does not need a repository-interface change. */
  findByStripeAccountId(stripeAccountId: string): Promise<CompanyPayoutAccountRecord | null>;

  /** Insert-or-replace the company's single payout destination — a
   *  company has at most one active payout account at a time, same
   *  "single current value" shape as `ProfessionalOnboardingRepository
   *  .upsertPayoutAccount`. */
  upsertPayoutAccount(data: CreateCompanyPayoutAccountData): Promise<CompanyPayoutAccountRecord>;

  /** Updates only the Stripe-mirrored fields on an *existing* company
   *  payout account row — never creates one itself. Throws
   *  `NotFoundError` if no row exists yet for `companyProfileId` — same
   *  precondition `ProfessionalOnboardingRepository
   *  .updateStripeConnectAccount` enforces. */
  updateStripeConnectAccount(
    companyProfileId: string,
    data: UpdateCompanyStripeConnectAccountData,
  ): Promise<CompanyPayoutAccountRecord>;
}
