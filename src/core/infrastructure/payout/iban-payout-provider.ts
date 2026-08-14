import { ValidationError } from "@/domain/errors/domain-error";
import { hashSecret } from "@/domain/services/security-key";
import { isValidIban, maskIban, normalizeIban } from "@/domain/services/professional-onboarding-rules";
import type {
  PayoutProvider,
  RegisterPayoutDestinationRequest,
  RegisterPayoutDestinationResult,
} from "@/application/ports/payout-provider";

/**
 * Module 62 — Professional Onboarding.
 *
 * `PayoutProvider` implementation for the `IBAN` method. Deliberately has
 * no external dependency at all — no bank API, no SDK — it only validates
 * (`isValidIban`, ISO 13616/mod-97) and masks/hashes (`maskIban`/
 * `hashSecret`) the raw IBAN locally. `status` is always `PENDING`: this
 * class establishes that the IBAN is *structurally* valid, never that the
 * bank account itself exists or belongs to the professional — that
 * requires a future, genuinely external verification step this module
 * does not implement (see the module brief's "architecture must support...
 * future payout providers", not "must already verify them").
 *
 * The raw IBAN is never persisted or logged by this class — only
 * `maskIban`'s last-4 and `hashSecret`'s keyed hash cross the boundary
 * back to the caller (see `RegisterPayoutDestinationResult`'s own doc
 * comment).
 */
export class IbanPayoutProvider implements PayoutProvider {
  readonly method = "IBAN" as const;

  constructor(private readonly hashPepper: string) {}

  async registerDestination(request: RegisterPayoutDestinationRequest): Promise<RegisterPayoutDestinationResult> {
    if (!request.iban) {
      throw new ValidationError("An IBAN is required to register an IBAN payout destination.");
    }
    if (!isValidIban(request.iban)) {
      throw new ValidationError("Enter a valid IBAN.");
    }

    const normalized = normalizeIban(request.iban);

    return {
      method: "IBAN",
      status: "PENDING",
      maskedAccount: maskIban(normalized),
      accountHash: hashSecret(normalized, this.hashPepper, "iban"),
      externalReference: null,
    };
  }
}
