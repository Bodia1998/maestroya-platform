import type { ProviderVerificationOutcome } from "@/domain/services/verification-provider-outcome";
import type { VerificationProviderValue } from "@/domain/services/professional-verification-rules";

/**
 * Module 59 — Professional Verification (Persona).
 *
 * The single abstraction application code is allowed to depend on for
 * talking to an external identity-verification (KYC) provider. No Persona
 * SDK type, no `Inquiry`, no Persona webhook payload shape appears here or
 * anywhere it's called from — the exact same "provider MUST NOT appear
 * anywhere in this module" rule `PaymentGateway`'s own doc comment
 * documents for Stripe (application/ports/payment-gateway.ts), applied to
 * KYC instead of payments.
 *
 * `NullVerificationProvider` (infrastructure/verification/
 * null-verification-provider.ts) is the implementation used whenever
 * `VERIFICATION_PROVIDER` is unset/`manual` — the entire Module 17 manual
 * document-review workflow keeps working unchanged, since no use case that
 * depends on `VerificationProviderRepository`/`ProfessionalVerificationRepository`
 * directly requires this port at all. `PersonaVerificationProvider`
 * (infrastructure/verification/persona-verification-provider.ts) is
 * today's only real implementation. `createVerificationProvider()`
 * (infrastructure/verification/verification-provider-factory.ts) is the
 * one place that decides which of the two a process gets — swapping in a
 * third KYC provider later means adding one more infrastructure adapter
 * and one more `case` in that factory; no application use case changes.
 */
export interface StartVerificationRequest {
  /** The domain `ProfessionalVerification.id` this provider inquiry is
   *  for — lets the provider attach its own external reference back to a
   *  specific case, and is echoed into `metadata` on the provider's side
   *  when supported, purely for the provider's own support tooling. */
  verificationId: string;
  /** The professional's full legal name as it should appear on the
   *  identity check, and the two-letter country code the platform expects
   *  their document to be issued in (`ES` for the common DNI/NIE case,
   *  but not assumed — a professional may hold a foreign passport).
   *  Deliberately the *only* personal data this port's request shape
   *  carries — no address, no date of birth, no document images: Persona
   *  collects the rest directly from the professional through its own
   *  hosted flow (see `verificationUrl` on `StartVerificationResult`),
   *  never routed through this platform's servers. See this module's
   *  GDPR/data-minimization notes in
   *  docs/MODULE_59_PROFESSIONAL_VERIFICATION_PERSONA.md. */
  fullName: string;
  countryCode: string;
}

export interface StartVerificationResult {
  /** The provider's own identifier for the created inquiry — opaque to
   *  the domain, persisted as `ProfessionalVerification.providerVerificationId`
   *  so a later `getVerification`/`refreshStatus`/webhook call can
   *  reference the same inquiry. */
  providerVerificationId: string;
  /** A short-lived, provider-hosted URL the professional is redirected to
   *  (or shown in an iframe) to complete the identity/selfie/liveness
   *  checks. Never persisted (see `ProfessionalVerification`'s own doc
   *  comment in schema.prisma) — regenerate via `generateVerificationLink`
   *  if a caller needs it again after this initial response expires. */
  verificationUrl: string;
  outcome: ProviderVerificationOutcome;
}

export interface VerificationStatusResult {
  providerVerificationId: string;
  outcome: ProviderVerificationOutcome;
  /** The provider's own raw status string, kept only for observability —
   *  see `ProfessionalVerification.providerStatus`'s own doc comment for
   *  why this is never the source of truth for the case's status. */
  rawStatus: string;
  /** Present only when the provider itself supplies a failure/decline
   *  reason (e.g. Persona's inquiry `declineReasons`) — surfaced to an
   *  admin reviewing a NEEDS_REVIEW/REJECTED case, never to the public
   *  professional profile. */
  failureReason?: string | null;
  checkedAt: Date;
}

export interface WebhookValidationResult {
  /** `false` for a payload whose signature does not match — the only
   *  thing a caller needs to know before it may trust any other field on
   *  this result. Module 59 ships this validation method so the
   *  abstraction is webhook-ready; no route actually calls it yet (real
   *  webhook *processing* is out of this module's scope — see
   *  docs/MODULE_59_PROFESSIONAL_VERIFICATION_PERSONA.md, "Webhook
   *  preparation"). */
  valid: boolean;
  providerVerificationId?: string;
  outcome?: ProviderVerificationOutcome;
  rawStatus?: string;
}

export interface VerificationProvider {
  /** The provider name this implementation reports for
   *  `ProfessionalVerification.provider` — `"PERSONA"` for
   *  `PersonaVerificationProvider`, `"MANUAL"` for `NullVerificationProvider`. */
  readonly name: VerificationProviderValue;

  /** Starts a new inquiry with the provider and returns a hosted link the
   *  professional completes it through. */
  createVerification(request: StartVerificationRequest): Promise<StartVerificationResult>;

  /** Reads the provider's last-known status for an existing inquiry
   *  without necessarily forcing the provider to re-evaluate it. */
  getVerification(providerVerificationId: string): Promise<VerificationStatusResult>;

  /** Asks the provider to (re-)evaluate the inquiry now and returns the
   *  resulting status — the call `RefreshVerificationStatusUseCase`/
   *  `SynchronizeVerificationUseCase` make. For providers with no
   *  separate "force re-check" operation this may be implemented
   *  identically to `getVerification`. */
  refreshStatus(providerVerificationId: string): Promise<VerificationStatusResult>;

  /** Regenerates a fresh hosted verification link for an inquiry whose
   *  original `verificationUrl` has expired, without starting a second
   *  inquiry. */
  generateVerificationLink(providerVerificationId: string): Promise<string>;

  /** Verifies an inbound webhook payload's signature against the
   *  configured provider secret and, only if valid, parses it into a
   *  normalized outcome. Synchronous and side-effect-free — it never
   *  itself writes to `ProfessionalVerificationRepository`; that remains
   *  a future webhook-processing use case's job (see this interface's
   *  own doc comment). */
  webhookValidation(rawBody: string, signatureHeader: string | null): WebhookValidationResult;
}
