import type {
  OnboardingStatusValue,
  PayoutAccountStatusValue,
  PayoutMethodValue,
  StripeExpressReadinessValue,
} from "@/domain/services/professional-onboarding-rules";

/**
 * Module 62 — Professional Onboarding.
 *
 * Repository interface for the `ProfessionalOnboarding` aggregate and its
 * associated `ProfessionalPayoutAccount` — the two tables this module
 * actually adds (see prisma/schema.prisma's "Module 62" section). Follows
 * the same "narrow, module-scoped, record-shaped interface" convention as
 * `ProfessionalVerificationRepository` (Module 17) — no `Entity<Props>`
 * subclass; pure business rules live in `domain/services/professional-
 * onboarding-rules.ts`, this file only defines the shape data is read/
 * written in.
 *
 * Deliberately does **not** expose methods for terms/privacy acceptance
 * (that's the existing `ConsentRepository`, Module 38 — see
 * `AcceptOnboardingTermsUseCase`/`AcceptOnboardingPrivacyPolicyUseCase`),
 * identity verification (Module 17/59's own `ProfessionalVerificationRepository`),
 * or profile fields (`ProfessionalRepository`). This module orchestrates
 * those, it does not re-own their storage.
 */

export interface ProfessionalOnboardingRecord {
  id: string;
  professionalProfileId: string;
  status: OnboardingStatusValue;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfessionalPayoutAccountRecord {
  id: string;
  professionalProfileId: string;
  method: PayoutMethodValue;
  status: PayoutAccountStatusValue;
  accountHolderName: string;
  /** Last 4 characters only — see `maskIban` (`professional-onboarding-
   *  rules.ts`). `null` for a non-IBAN method. */
  ibanLast4: string | null;
  /** Keyed hash of the full IBAN (`hashSecret`, `domain/services/
   *  security-key.ts`) — used only for duplicate-account detection, never
   *  reversible back to the original IBAN. `null` for a non-IBAN method. */
  ibanHash: string | null;
  /** Stripe Connect Express account id (`acct_...`). `null` until
   *  `CreateStripeConnectedAccountUseCase` (Module 71) creates the real
   *  account — never populated by this module's own onboarding-selection
   *  step (see Step 6's "no Stripe SDK" rule). */
  stripeExpressAccountId: string | null;
  stripeExpressStatus: StripeExpressReadinessValue;
  /** Module 71 — Stripe Connect: the account's own capability/onboarding
   *  flags, mirrored from Stripe's last-known state (see
   *  `StripeAccountStatusResult` — `application/ports/stripe-connect-
   *  gateway.ts`) by `GetStripeAccountStatusUseCase`. Distinct from
   *  `stripeExpressStatus` — see `domain/services/stripe-connect-account-
   *  rules.ts`'s own doc comment for why these three states never
   *  collapse into one. Always `false`/`null` until a connected account
   *  exists.
   *
   *  POST-AUDIT CORRECTION: despite its name, this column mirrors
   *  `StripeAccountStatusResult.transfersActive` (Stripe's `transfers`
   *  capability-active status), NOT Stripe's literal account-level
   *  `charges_enabled` field. MaestroYa's connected accounts only ever
   *  request the `transfers` capability (see
   *  `StripeConnectGatewayAdapter.createConnectedAccount`'s own
   *  comment), under which `charges_enabled` is never a meaningful
   *  signal — see `stripe-connect-account-rules.ts`'s own "post-audit
   *  correction" doc comment for the full reasoning. The column is
   *  intentionally *not* renamed/migrated: its existing `Boolean NOT
   *  NULL DEFAULT false` shape already correctly represents the
   *  corrected value with no schema change required. Do not read this
   *  field as Stripe's `charges_enabled` — read it as "can the platform
   *  currently transfer funds into this account." */
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  /** `true` when Stripe last reported at least one `requirements.
   *  currently_due` entry for this account — see
   *  `StripeAccountStatusResult.requirementsCurrentlyDue`'s own doc
   *  comment for why only this boolean (never the raw requirement list)
   *  is persisted. */
  stripeRequirementsCurrentlyDue: boolean;
  /** When these Stripe-mirrored fields were last refreshed from Stripe —
   *  `null` until the first successful `GetStripeAccountStatusUseCase`
   *  call. Lets a future Module 72 webhook handler and this module's own
   *  polling-based sync both write to the same fields without either
   *  needing to know which one last ran. */
  stripeConnectSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePayoutAccountData {
  professionalProfileId: string;
  method: PayoutMethodValue;
  status: PayoutAccountStatusValue;
  accountHolderName: string;
  ibanLast4?: string | null;
  ibanHash?: string | null;
  stripeExpressStatus?: StripeExpressReadinessValue;
}

/**
 * Module 71 — Stripe Connect: the fields `updateStripeConnectAccount` may
 * change — deliberately excludes `method`/`status`/`accountHolderName`/
 * `ibanLast4`/`ibanHash` (those remain `upsertPayoutAccount`'s exclusive
 * concern; a Stripe-status sync never touches the professional's chosen
 * payout method or IBAN details).
 */
export interface UpdateStripeConnectAccountData {
  stripeExpressAccountId?: string;
  stripeExpressStatus?: StripeExpressReadinessValue;
  /** See `ProfessionalPayoutAccountRecord.stripeChargesEnabled`'s own
   *  doc comment — this is Stripe's `transfers` capability-active
   *  status, not the literal `charges_enabled` field. */
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
  stripeDetailsSubmitted?: boolean;
  stripeRequirementsCurrentlyDue?: boolean;
  stripeConnectSyncedAt?: Date;
}

export interface ProfessionalOnboardingRepository {
  findByProfessionalProfileId(professionalProfileId: string): Promise<ProfessionalOnboardingRecord | null>;

  /** Opens a fresh IN_PROGRESS onboarding record for the given professional
   *  profile. Callers (`StartProfessionalOnboardingUseCase`) are
   *  responsible for the "get or create" idempotency check — this always
   *  inserts a new row. */
  create(professionalProfileId: string): Promise<ProfessionalOnboardingRecord>;

  /** Marks the given onboarding record ACTIVATED. Implementations should
   *  treat activating an already-ACTIVATED record as an idempotent no-op
   *  returning the existing record, matching `ConsentRepository.withdraw`'s
   *  own "idempotent" convention — `ActivateProfessionalUseCase` re-checks
   *  eligibility every time regardless, so this is a defensive convenience,
   *  not the only guard. */
  activate(id: string, activatedAt: Date): Promise<ProfessionalOnboardingRecord>;

  findPayoutAccountByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalPayoutAccountRecord | null>;

  /** Module 71 — Stripe Connect: lookup by the Stripe-side identifier
   *  rather than the MaestroYa-side one — the shape a future Module 72
   *  webhook handler needs (Stripe's `account.updated` event carries only
   *  the Stripe account id, never `professionalProfileId`). Unused by
   *  this module's own use cases today; added now so Module 72 does not
   *  need a repository-interface change to support webhook synchronization. */
  findPayoutAccountByStripeAccountId(stripeAccountId: string): Promise<ProfessionalPayoutAccountRecord | null>;

  /** Insert-or-replace the professional's single payout destination — a
   *  professional has at most one active payout account at a time
   *  (switching from IBAN to Stripe Express, or updating IBAN details,
   *  replaces it rather than accumulating history). */
  upsertPayoutAccount(data: CreatePayoutAccountData): Promise<ProfessionalPayoutAccountRecord>;

  /** Module 71 — Stripe Connect: updates only the Stripe-mirrored fields
   *  on an *existing* payout account row (one created by
   *  `upsertPayoutAccount` when the professional selected `STRIPE_EXPRESS`
   *  as their method) — never creates a row itself. Callers
   *  (`CreateStripeConnectedAccountUseCase`/`GetStripeAccountStatusUseCase`)
   *  are responsible for the "payout account already exists with method
   *  STRIPE_EXPRESS" precondition; this method throws `NotFoundError` if
   *  it does not. */
  updateStripeConnectAccount(
    professionalProfileId: string,
    data: UpdateStripeConnectAccountData,
  ): Promise<ProfessionalPayoutAccountRecord>;

  /** Every ACTIVATED onboarding record — feeds `onboarding-report-
   *  generator.ts`'s activation-rate statistics. */
  countByStatus(status: OnboardingStatusValue): Promise<number>;
}
