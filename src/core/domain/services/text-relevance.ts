/**
 * Search & Ranking module (Module 19) — text relevance scoring.
 *
 * A small, deterministic, dependency-free stand-in for full-text search
 * ranking: token overlap between the search query and the candidate's
 * searchable fields (name, headline/description, business/legal name).
 * This intentionally does not use PostgreSQL's `tsvector`/`ts_rank` — the
 * *filtering* (does this candidate match at all) is pushed to the database
 * via `ILIKE`/`contains` in the Prisma repositories for performance, but
 * the relative *ranking* of already-matched candidates is computed here in
 * the domain layer so it stays framework-independent and unit-testable
 * without a database.
 */

// Unicode range U+0300–U+036F covers the combining diacritical marks left
// behind by NFD normalization (e.g. "é" -> "e" + U+0301). Stripping them
// lets "cafe" match "café".
const COMBINING_DIACRITICS_LOW = 0x0300;
const COMBINING_DIACRITICS_HIGH = 0x036f;
const COMBINING_DIACRITICS = new RegExp(
  `[\\u${COMBINING_DIACRITICS_LOW.toString(16).padStart(4, "0")}-\\u${COMBINING_DIACRITICS_HIGH.toString(16).padStart(4, "0")}]`,
  "g",
);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Returns a relevance score in [0, 1]:
 * - 1.0 when every query token appears in the combined searchable text,
 * - a partial fraction (matched tokens / total tokens) otherwise,
 * - 0 when the query is empty/whitespace-only (no query means "not
 *   applicable", not "worst match" — callers should not penalize candidates
 *   for an absent query; the ranking engine gives this signal zero weight
 *   contribution in that case).
 */
export function computeTextRelevance(query: string | null | undefined, searchableFields: (string | null)[]): number {
  const queryTokens = tokenize(query ?? "");
  if (queryTokens.length === 0) return 0;

  const haystack = tokenize(searchableFields.filter((field): field is string => Boolean(field)).join(" "));
  if (haystack.length === 0) return 0;

  const haystackSet = new Set(haystack);
  const matched = queryTokens.filter((token) => haystackSet.has(token)).length;

  return matched / queryTokens.length;
}
