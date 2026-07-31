export interface LanguageRecord {
  id: string;
  name: string;
  nativeName: string;
}

/**
 * Narrow read-only interface onto the Language reference table — platform/
 * interface language data (see the `Language` model's own doc comment in
 * schema.prisma), NOT a professional-facing feature. `listActive` supports
 * a language picker (e.g. a user's preferred platform language);
 * `findActiveByIds` re-validates a set of client-submitted language ids
 * against active rows before trusting them. Mirrors
 * ServiceCategoryRepository's own shape exactly — same "listActive for the
 * picker, findActiveByIds to re-validate client-submitted ids" convention.
 * Language CRUD itself is out of scope here — see prisma/seed.ts.
 *
 * Currently unused by any active use case (the platform-language picker on
 * the Profile page reads `prisma.language` directly, matching the
 * convention documented in profile/page.tsx) — kept as a ready-made seam
 * for a future use case that needs language validation through the regular
 * repository layer rather than a direct Prisma read.
 */
export interface LanguageRepository {
  listActive(): Promise<LanguageRecord[]>;
  findActiveByIds(ids: string[]): Promise<LanguageRecord[]>;
}
