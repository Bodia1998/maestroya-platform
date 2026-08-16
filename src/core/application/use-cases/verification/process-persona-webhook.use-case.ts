import type { ExternalWebhookEventRepository } from "@/domain/repositories/external-webhook-event-repository";
import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import type { RefreshVerificationStatusUseCase } from "@/application/use-cases/verification/refresh-verification-status.use-case";

export interface ProcessPersonaWebhookInput {
  /** Persona's own `Event.id` — already extracted and signature-verified
   *  by `PersonaVerificationProvider.webhookValidation` before this use
   *  case is ever called. Never trusted from anywhere else. */
  externalEventId: string;
  eventType: string | null;
  /** Persona's `Inquiry.id`, if the webhook's payload embedded one — also
   *  already extracted by `webhookValidation`. `null` for an event type
   *  this platform doesn't track an inquiry for (acknowledged as
   *  `"ignored"`, never an error). */
  providerVerificationId: string | null;
}

export type ProcessPersonaWebhookOutcome =
  /** First delivery (or a retry of a previously failed delivery):
   *  `RefreshVerificationStatusUseCase` ran against the matched case. */
  | "processed"
  /** This exact event was already claimed by an earlier delivery
   *  (in-flight or completed) — no side effect ran this time, by design. */
  | "duplicate"
  /** Signature-valid event with no embedded inquiry (an event type this
   *  platform doesn't act on) — acknowledged, nothing to synchronize. */
  | "ignored"
  /** Signature-valid event for a `providerVerificationId` this platform
   *  never issued/recorded — acknowledged (never a 4xx: retrying would
   *  never make it match), but distinct from `"ignored"` for logging. */
  | "unmatched";

export interface ProcessPersonaWebhookResult {
  outcome: ProcessPersonaWebhookOutcome;
  verificationId?: string;
}

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objectives A
 * & B): the application-layer use case
 * `src/app/api/webhooks/persona/route.ts` delegates to, once the Route
 * Handler has already verified the inbound request's signature via the
 * existing `PersonaVerificationProvider`/`VerificationProvider` port (see
 * that port's own doc comment — this use case is never itself given a raw
 * body or a signature header, and never re-implements or duplicates that
 * verification).
 *
 * ## IDOR/BOLA safety
 * The webhook body's `providerVerificationId` (Persona's own `Inquiry.id`)
 * is resolved against this platform's own
 * `ProfessionalVerificationRepository.findByProviderVerificationId` —
 * never trusted as, or used to look up, any user-supplied identifier
 * directly. If it doesn't match a case this platform actually created,
 * the event is acknowledged as `"unmatched"` and nothing is written.
 *
 * ## Never trusts the webhook body's embedded status
 * Once the matching internal case is found, this use case calls
 * `RefreshVerificationStatusUseCase.execute(verification.id)` — which
 * re-fetches the inquiry's current status from Persona's own API
 * (`VerificationProvider.refreshStatus`) rather than applying whatever
 * status the webhook body claimed. This is deliberate defense in depth:
 * even though the signature has already been verified by this point, the
 * case's actual state transition is always driven by a fresh,
 * platform-initiated read of Persona's authoritative state — exactly the
 * same use case, and the same VERIFIED/REJECTED/NEEDS_REVIEW/EXPIRED/
 * unknown-status handling and `canTransition`/`resolveProviderStatusTransition`
 * safety, that already backs the professional's own manual "check status"
 * action and `SynchronizeVerificationUseCase`'s batch sync — there is no
 * second, webhook-specific state-transition path anywhere in this module.
 *
 * ## Idempotency
 * `ExternalWebhookEventRepository.claim()` is called before anything else
 * — a duplicate delivery of the same Persona event (retried delivery, or
 * two concurrent deliveries) short-circuits to `"duplicate"` with zero
 * side effects, DB-uniqueness-backed (see that repository's own doc
 * comment).
 */
export class ProcessPersonaWebhookUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly webhookEvents: ExternalWebhookEventRepository,
    private readonly refresh: RefreshVerificationStatusUseCase,
  ) {}

  async execute(input: ProcessPersonaWebhookInput): Promise<ProcessPersonaWebhookResult> {
    const claim = await this.webhookEvents.claim({
      provider: "PERSONA",
      externalEventId: input.externalEventId,
      eventType: input.eventType,
    });

    if (!claim.claimed) {
      return { outcome: "duplicate" };
    }

    try {
      if (!input.providerVerificationId) {
        await this.webhookEvents.markProcessed(claim.record.id);
        return { outcome: "ignored" };
      }

      const verification = await this.verifications.findByProviderVerificationId(input.providerVerificationId);
      if (!verification) {
        await this.webhookEvents.markProcessed(claim.record.id);
        return { outcome: "unmatched" };
      }

      await this.refresh.execute(verification.id);
      await this.webhookEvents.markProcessed(claim.record.id);
      return { outcome: "processed", verificationId: verification.id };
    } catch (error) {
      // The claim stays claimable by a later retry — see
      // ExternalWebhookEventRepository's own doc comment on why FAILED
      // (and only FAILED) may be re-claimed. Persona's own delivery retry
      // will naturally re-send a non-2xx-acknowledged webhook.
      await this.webhookEvents.markFailed(claim.record.id);
      throw error;
    }
  }
}
