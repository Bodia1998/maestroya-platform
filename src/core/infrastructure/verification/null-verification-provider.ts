import type {
  StartVerificationRequest,
  StartVerificationResult,
  VerificationProvider,
  VerificationStatusResult,
  WebhookValidationResult,
} from "@/application/ports/verification-provider";

/**
 * Module 59 — Professional Verification (Persona).
 *
 * Thrown by every `NullVerificationProvider` method. Unlike
 * `PaymentGatewayNotConfiguredError` (infrastructure/payments/
 * null-payment-gateway.ts), this is not "a real implementation doesn't
 * exist yet" — the Module 17 manual document-review workflow is a fully
 * supported, production-ready path on its own (`CreateProfessionalVerificationUseCase`/
 * `SubmitProfessionalVerificationUseCase`/... never depend on
 * `VerificationProvider` at all). This error exists only to fail loudly if
 * `StartProfessionalVerificationUseCase`/`RefreshVerificationStatusUseCase`
 * are ever called while `VERIFICATION_PROVIDER=manual` (the default,
 * meaning no automated provider is configured) — the caller should have
 * checked `VerificationProvider.name === "MANUAL"` and offered the manual
 * upload flow instead of an automated-check button.
 */
export class VerificationProviderNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `VerificationProvider.${operation}() was called, but VERIFICATION_PROVIDER is "manual" — ` +
        `no automated KYC provider is configured. The Module 17 manual document-upload/admin-review ` +
        `flow is fully available and does not depend on this port at all; only the ` +
        `Start/RefreshVerificationStatus (Module 59) use cases should ever reach this class, and only ` +
        `if a caller failed to check VerificationProvider.name first.`,
    );
    this.name = "VerificationProviderNotConfiguredError";
  }
}

/**
 * `VerificationProvider` implementation used whenever
 * `VERIFICATION_PROVIDER` is unset or `manual` — the default. Lets every
 * Module 59 use case that depends on the port be composed and compiled
 * without a real KYC provider configured, exactly the "always something to
 * inject" role `NullPaymentGateway`/`NullNotificationCreator` already play
 * for their own ports.
 */
export class NullVerificationProvider implements VerificationProvider {
  readonly name = "MANUAL" as const;

  async createVerification(_request: StartVerificationRequest): Promise<StartVerificationResult> {
    throw new VerificationProviderNotConfiguredError("createVerification");
  }

  async getVerification(_providerVerificationId: string): Promise<VerificationStatusResult> {
    throw new VerificationProviderNotConfiguredError("getVerification");
  }

  async refreshStatus(_providerVerificationId: string): Promise<VerificationStatusResult> {
    throw new VerificationProviderNotConfiguredError("refreshStatus");
  }

  async generateVerificationLink(_providerVerificationId: string): Promise<string> {
    throw new VerificationProviderNotConfiguredError("generateVerificationLink");
  }

  webhookValidation(_rawBody: string, _signatureHeader: string | null): WebhookValidationResult {
    return { valid: false };
  }
}
