/**
 * Module 120 — Multilingual Localization: service category names.
 *
 * `ServiceCategory.name`/`description` are stored once, in Spanish (they
 * are seeded reference data, see `prisma/seed.ts`), and `slug` is the
 * stable identifier. Rather than adding translation columns/tables for
 * six categories and their professions, their localised names live in the
 * `services.categories.<slug>` catalog entries, and this helper chooses:
 *
 *   catalog entry for the slug → the database value (unchanged).
 *
 * So a category an admin adds later without a catalog entry still renders
 * (in Spanish) instead of breaking, and nothing in the database is
 * duplicated or overwritten. See the Module 120 report, "Dynamic content".
 */

/** The minimal translator shape: `t(key)` + `t.has(key)` bound to the `services` namespace. */
export interface ServicesTranslator {
  (key: string): string;
  has(key: string): boolean;
}

export interface CategoryLike {
  slug?: string | null;
  name: string;
  description?: string | null;
}

export function localizeCategoryName(t: unknown, category: CategoryLike): string {
  const translator = t as ServicesTranslator;
  const key = category.slug ? `categories.${category.slug}.name` : null;
  return key && translator.has(key) ? translator(key) : category.name;
}

export function localizeCategoryDescription(t: unknown, category: CategoryLike): string | null {
  const translator = t as ServicesTranslator;
  const key = category.slug ? `categories.${category.slug}.description` : null;
  return key && translator.has(key) ? translator(key) : (category.description ?? null);
}
