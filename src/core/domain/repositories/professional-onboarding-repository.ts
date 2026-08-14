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
  /** Opaque future Stripe Express Connect account id — never populated by
   *  this module (see Step 6's "no Stripe SDK" rule); reserved for Module
   *  65 to write once a real account exists. `null` until then. */
  stripeExpressAccountId: string | null;
  stripeExpressStatus: StripeExpressReadinessValue;
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

  /** Insert-or-replace the professional's single payout destination — a
   *  professional has at most one active payout account at a time
   *  (switching from IBAN to Stripe Express, or updating IBAN details,
   *  replaces it rather than accumulating history). */
  upsertPayoutAccount(data: CreatePayoutAccountData): Promise<ProfessionalPayoutAccountRecord>;

  /** Every ACTIVATED onboarding record — feeds `onboarding-report-
   *  generator.ts`'s activation-rate statistics. */
  countByStatus(status: OnboardingStatusValue): Promise<number>;
}
