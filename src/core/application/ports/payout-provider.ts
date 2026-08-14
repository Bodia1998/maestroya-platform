import type {
  PayoutAccountStatusValue,
  PayoutMethodValue,
} from "@/domain/services/professional-onboarding-rules";

/**
 * Module 62 — Professional Onboarding.
 *
 * The single abstraction application code is allowed to depend on for
 * recording a professional's payout destination. No bank-API type, no
 * Stripe SDK type, no `Account`/`ExternalAccount` shape appears here or
 * anywhere it's called from — the same "provider MUST NOT appear anywhere
 * in this module" rule `PaymentGateway`'s own doc comment documents for
 * Stripe payments (`application/ports/payment-gateway.ts`) and
 * `VerificationProvider`'s documents for Persona KYC
 * (`application/ports/verification-provider.ts`), applied here to payout
 * destinations.
 *
 * `IbanPayoutProvider` (`infrastructure/payout/iban-payout-provider.ts`)
 * validates and records an IBAN destination entirely locally — no external
 * call, no SDK, matching the module brief's "future payout providers"
 * requirement without over-building for one that isn't needed today.
 * `StripeExpressPayoutProvider` (`infrastructure/payout/stripe-express-
 * payout-provider.ts`) *only* prepares onboarding state — it deliberately
 * never imports the Stripe SDK (see that class's own doc comment) — ready
 * for the future Module 65 (Stripe Connect) to layer real account
 * creation on top without this port, `SetPayoutDestinationUseCase`, or
 * `ProfessionalPayoutAccountRepository` needing to change.
 * `getPayoutProvider()` (`infrastructure/payout/payout-provider-factory.ts`)
 * is the one place a caller resolves a `PayoutMethodValue` to a concrete
 * implementation — adding a third payout method later means one more
 * adapter and one more `case` there, no application use case changes.
 */
export interface RegisterPayoutDestinationRequest {
  /** The `ProfessionalProfile.id` this destination belongs to — carried
   *  through so a real future provider (e.g. Stripe Express) can attach
   *  its own external reference back to a specific professional, exactly
   *  as `StartVerificationRequest.verificationId` does for Persona. */
  professionalProfileId: string;
  accountHolderName: string;
  /** Present only for `method: "IBAN"` — the raw IBAN, used only inside
   *  this call to validate/mask/hash it. Never itself returned or logged;
   *  see `RegisterPayoutDestinationResult.maskedAccount`/`accountHash`. */
  iban?: string;
}

export interface RegisterPayoutDestinationResult {
  method: PayoutMethodValue;
  status: PayoutAccountStatusValue;
  /** Safe-to-display identifier for the destination (e.g. `"****1234"`
   *  for an IBAN, or a fixed "pending Stripe Express onboarding" label) —
   *  never the raw account number. */
  maskedAccount: string;
  /** Keyed hash of the raw account identifier, for duplicate-destination
   *  detection only — `null` for a method with no such identifier yet
   *  (Stripe Express, until Module 65 creates a real account). */
  accountHash: string | null;
  /** The provider's own external account id, if one already exists.
   *  Always `null` for both implementations shipped by this module (see
   *  each class's own doc comment) — reserved for a future real Stripe
   *  Express adapter. */
  externalReference: string | null;
}

export interface PayoutProvider {
  /** The payout method this implementation handles — mirrors
   *  `VerificationProvider.name`'s role for identity verification. */
  readonly method: PayoutMethodValue;

  /** Validates and registers a payout destination, returning the
   *  safe-to-persist result. Throws `ValidationError`
   *  (`domain/errors/domain-error.ts`) for a structurally invalid
   *  destination (e.g. a malformed IBAN) — never a provider-specific
   *  error type, keeping this port's failure contract as provider-agnostic
   *  as its success contract. */
  registerDestination(request: RegisterPayoutDestinationRequest): Promise<RegisterPayoutDestinationResult>;
}
