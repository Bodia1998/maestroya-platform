import type { UserRepository } from "@/domain/repositories/user-repository";
import { toLocale, type Locale } from "@/shared/i18n/locales";

/**
 * Module 29 — Internationalization.
 *
 * Reads an authenticated user's stored interface language, narrowed to a
 * locale this build actually ships messages for.
 *
 * Returns `null` — never throws, never defaults to Spanish — for all
 * three of "no such user", "never chose one", and "chose a code this
 * deployment no longer supports". Collapsing those into a default here
 * would hide the distinction from `resolveAuthenticatedLocale`, which is
 * the single place allowed to decide what absence means (it falls through
 * to `Accept-Language` first, and only then to Spanish). A stale code in
 * the column — e.g. a language that was removed from the product, or one
 * written by a newer deployment during a rolling deploy — degrades to
 * that same chain instead of rendering raw message keys.
 */
export class GetUserLanguagePreferenceUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(userId: string): Promise<Locale | null> {
    const stored = await this.users.getPreferredLocale(userId);
    return toLocale(stored);
  }
}
