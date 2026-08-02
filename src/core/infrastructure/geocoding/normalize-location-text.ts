/**
 * Module 27 — Spain Location Services.
 *
 * Shared text normalization for anything that treats a city/province name
 * as a lookup or cache key — `StaticCityGeocodingProvider`'s table lookup
 * and `CachedGeocodingProvider`'s cache key both need the exact same
 * normalization, or the same real-world place could silently produce two
 * different keys between them (a cache entry that never hits because the
 * static provider's own matching is more forgiving than the cache's).
 * Centralized here once rather than duplicated so that guarantee holds by
 * construction, not by two implementations happening to agree.
 *
 * Normalizes:
 *   - leading/trailing whitespace (trim)
 *   - internal runs of whitespace collapsed to a single space
 *     (e.g. "Alcala  de   Henares" -> "alcala de henares")
 *   - case (lowercase)
 *   - diacritics/accents stripped ("Valencia" spelled with an accented a,
 *     an accented i, or in all caps all normalize identically)
 *
 * "Valencia", "VALENCIA", "valencia", " Valencia " (with a stray accent on
 * the a), and the same with an accent on the e all normalize to the
 * identical string "valencia".
 */
const COMBINING_DIACRITICS_PATTERN = /[\u0300-\u036f]/g;
const WHITESPACE_RUN_PATTERN = /\s+/g;

export function normalizeLocationText(value: string): string {
  return value
    .trim()
    .replace(WHITESPACE_RUN_PATTERN, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_PATTERN, ""); // strip combining diacritics (accented vowels, ñ, etc.)
}
