import type { RegistrationAttributionLinker } from "@/application/ports/registration-attribution-linker";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";

/**
 * Module 60 — Referral & Marketing Attribution Platform: the concrete
 * `RegistrationAttributionLinker` `RegisterUserUseCase` calls. Links the
 * new `User.id` onto the visitor's existing `MarketingAttribution` row (if
 * any) via `MarketingAttributionRepository.linkUser`, which is itself
 * already a no-op for a visitor with no attribution row — this class adds
 * one more layer of safety on top (a try/catch) so that even an
 * unexpected repository failure (e.g. a transient DB error) can never
 * propagate into `RegisterUserUseCase.execute` and fail a registration
 * over a non-critical analytics side effect.
 *
 * Deliberately does NOT also record a `REGISTRATION` `ConversionEvent`
 * here — this use case only knows `userId`/`visitorId`, not whether the
 * signup was a `PROFESSIONAL_REGISTRATION` vs `CLIENT_REGISTRATION`
 * (`RegisterUserUseCase` only has `input.intent` as a routing hint, not a
 * confirmed role — see `SignupIntent`'s own doc comment in schema.prisma).
 * Recording the conversion event is deferred to whichever future caller
 * actually knows the confirmed outcome — see docs/MODULE_60's "Remaining
 * Limitations".
 */
export class LinkRegistrationAttributionUseCase implements RegistrationAttributionLinker {
  constructor(private readonly attributions: MarketingAttributionRepository) {}

  async linkRegistration(userId: string, visitorId: string | null): Promise<void> {
    if (!visitorId) return;
    try {
      await this.attributions.linkUser(visitorId, userId);
    } catch {
      // Best-effort — never let an attribution-linking failure affect the
      // caller. RegisterUserUseCase also wraps this call in its own
      // try/catch, so this is defense in depth, not the only guard.
    }
  }
}
