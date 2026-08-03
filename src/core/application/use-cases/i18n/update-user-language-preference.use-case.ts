import { ValidationError } from "@/domain/errors/domain-error";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { isSupportedLocale, type Locale } from "@/shared/i18n/locales";

/**
 * Module 29 — Internationalization.
 *
 * Persists an authenticated user's interface-language choice. Deliberately
 * tiny: the whole point of routing the language switch through a use case
 * rather than letting the route handler call Prisma is that *every* write
 * in this codebase goes through the same layer, so authorization,
 * validation and persistence stay in one predictable place. There is no
 * "it's only a UI preference" exception to the architecture.
 *
 * Re-validates the locale even though `updateLanguagePreferenceSchema`
 * already did at the HTTP edge: the use case is also callable from a
 * Server Action, a seed script or a future admin tool, and a use case
 * that trusts its caller to have validated is a use case that will one
 * day be called by a caller that did not. `isSupportedLocale` is the same
 * predicate the schema is built from, so the two can never disagree.
 *
 * No notification, no audit-log entry, no email: changing your own
 * interface language is not a security-relevant account event (unlike a
 * password or email change) and logging one row per language toggle
 * would be noise. Called out here so its absence reads as a decision
 * rather than an omission.
 */
export class UpdateUserLanguagePreferenceUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(userId: string, locale: string): Promise<{ locale: Locale }> {
    if (!isSupportedLocale(locale)) {
      throw new ValidationError(`Unsupported locale: "${locale}".`);
    }

    await this.users.updatePreferredLocale(userId, locale);
    return { locale };
  }
}
