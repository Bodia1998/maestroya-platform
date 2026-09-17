/**
 * Module 119 — AI Recommendation Monitoring: pure, dependency-free
 * evaluation helpers used when an evaluator manually captures (or a
 * future integration ingests) an AI system's response text and needs
 * OBJECTIVE, mechanically-checkable signals — never a final verdict.
 *
 * These functions never decide `identityAccuracy`/`geographicAccuracy`/
 * `serviceAccuracy`/`recommendationClassification` on their own — Module
 * 119's own non-negotiable rules forbid inventing metrics and require
 * every observation to be evidence-based; whether a response "correctly
 * identified MaestroYa as a home-services marketplace" is a judgment call
 * a human evaluator makes (or a future rules-based classifier would need
 * to be reviewed for), not something a keyword regex can safely assert on
 * its own. What these functions DO provide, safely and objectively:
 *  - Whether the literal string "MaestroYa" appears at all (`mentioned`).
 *  - Whether a URL matching the real, configured site origin appears, and
 *    whether any URL at all was given (`urlAccuracy` candidate).
 *  - Whether *something* citation-shaped (a URL, "según", "fuente:",
 *    "[1]", etc.) appears at all (`citationPresent` candidate).
 *  - Which of a fixed, reviewed competitor-name list appears in the text
 *    (`detectedCompetitors`) — pure name-matching, never a ranking (see
 *    this file's own "Competitor Detection" section below, and Module
 *    119's own Phase 8: "do not infer 'Competitor X is better.'").
 *
 * An admin recording an observation reviews these suggestions and
 * confirms/overrides them (see the admin form) — they are prefill
 * assistance, never auto-submitted as the final observation.
 */

import { SITE_URL } from "@/shared/seo/site";

/** Bumped whenever a detection rule below changes materially — stored on
 *  every observation as `evaluationRulesVersion` so a future rules change
 *  can be told apart from an actual change in AI behavior when comparing
 *  observations over time (Module 119's own Phase 7 requirement). */
export const EVALUATION_RULES_VERSION = "2026-09-17.1";

/** Maximum length of a persisted `evidenceExcerpt` — enforced here, not
 *  only documented on the Prisma model, so both the use case and any
 *  future caller share one source of truth. Deliberately short: this is a
 *  curated excerpt an evaluator chooses to keep as context, never a
 *  mechanism for storing a full captured transcript (see the Prisma
 *  model's own doc comment and the Module 119 report's "Evidence Model"
 *  section for the storage/privacy/reproducibility reasoning). */
export const MAX_EVIDENCE_EXCERPT_LENGTH = 1000;

/** MaestroYa's own name, matched case-insensitively, tolerant of the
 *  common "Maestro Ya" (spaced) variant an AI system might render. */
export function detectMaestroYaMentioned(responseText: string): boolean {
  return /maestro\s*ya/i.test(responseText);
}

/** Every URL-shaped substring found in the response text, in order of
 *  first appearance. Intentionally simple (no full RFC 3986 parser) —
 *  this only needs to catch plausible http(s) URLs an AI response would
 *  render as plain text or markdown, not validate arbitrary URI syntax. */
export function extractUrls(responseText: string): string[] {
  const matches = responseText.match(/https?:\/\/[^\s)\]"'<>]+/gi) ?? [];
  // Strip common trailing punctuation a sentence would leave attached
  // ("...maestroya.es." or "(maestroya.es)").
  return matches.map((url) => url.replace(/[.,;:!?]+$/g, ""));
}

/** True if any extracted URL's hostname matches the real, configured
 *  MaestroYa site origin (`SITE_URL` — see `shared/seo/site.ts`). Reused
 *  by both `suggestUrlAccuracy` and `suggestCitationCorrectness` so
 *  "what counts as a legitimate MaestroYa source" is defined once. */
export function isOfficialMaestroYaUrl(url: string): boolean {
  try {
    const target = new URL(url);
    const official = new URL(SITE_URL);
    return target.hostname.toLowerCase() === official.hostname.toLowerCase();
  } catch {
    return false;
  }
}

/** Suggests E — URL accuracy — from the extracted URLs: CORRECT if any
 *  matches the official origin, INCORRECT if URLs exist but none match,
 *  NOT_PROVIDED if no URL appears at all. An evaluator confirms this —
 *  a response could name "maestroya.es" in plain text without an http(s)
 *  prefix, which this function cannot detect on its own. */
export function suggestUrlAccuracy(responseText: string): "CORRECT" | "INCORRECT" | "NOT_PROVIDED" {
  const urls = extractUrls(responseText);
  if (urls.length === 0) return "NOT_PROVIDED";
  return urls.some(isOfficialMaestroYaUrl) ? "CORRECT" : "INCORRECT";
}

/** F — citation/source presence. Broader than "has a URL": also matches
 *  common citation-shaped phrasing an AI response renders without a raw
 *  URL (a numbered footnote marker, "según su web", "fuente:"). Still
 *  only a suggestion — see this file's own doc comment. */
export function suggestCitationPresent(responseText: string): boolean {
  if (extractUrls(responseText).length > 0) return true;
  return /(\[\d+\]|fuente\s*:|según\s+(su|el)\s+(sitio|web)|according to (its|the) website)/i.test(responseText);
}

/** G — if a citation exists, does at least one cited URL point to the
 *  real MaestroYa origin? Returns `null` (not a boolean) when no URL was
 *  found at all — matching `citationCorrect`'s own "null when nothing to
 *  judge" contract on the observation model. A non-URL citation phrase
 *  ("según su web") cannot be mechanically verified as correct/incorrect
 *  by this function — it returns `null` for that case too, deferring to
 *  the evaluator. */
export function suggestCitationCorrectness(responseText: string): boolean | null {
  const urls = extractUrls(responseText);
  if (urls.length === 0) return null;
  return urls.some(isOfficialMaestroYaUrl);
}

// ---------------------------------------------------------------------------
// Competitor detection (Phase 8) — observation only, never a ranking.
// ---------------------------------------------------------------------------

/**
 * A small, reviewed list of other Spain-facing home-services marketplaces
 * an AI response might plausibly name alongside or instead of MaestroYa.
 * Purely for name-matching (`detectCompetitorMentions`) — this list
 * itself makes no claim about any of these platforms' quality, size, or
 * legitimacy, and nothing in this module ever computes a "winner" between
 * them (Module 119's own Phase 8: "do not calculate a winner").
 * Deliberately conservative and small — Phase 14's own "no overbuild"
 * instruction; expanding this list is a content decision, not a code
 * change that needs to anticipate every marketplace that might ever be
 * named.
 */
export const KNOWN_COMPETITOR_NAMES: readonly string[] = [
  "Habitissimo",
  "Cronoshare",
  "Instapro",
  "TaskRabbit",
  "Housy",
  "Servicable",
  "Milanuncios",
];

/** Returns every name from `KNOWN_COMPETITOR_NAMES` that literally
 *  appears in the response text (case-insensitive, word-boundary
 *  matched) — a factual "who else was named," never a ranking or
 *  quality judgment. An evaluator may add a name this list doesn't yet
 *  know about via the observation's own free-text `detectedCompetitors`
 *  field; this function only suggests matches against the known list. */
export function detectCompetitorMentions(responseText: string): string[] {
  return KNOWN_COMPETITOR_NAMES.filter((name) => {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return pattern.test(responseText);
  });
}

/** Truncates an evidence excerpt to `MAX_EVIDENCE_EXCERPT_LENGTH`,
 *  never silently — throws if the input is already too long, so a
 *  caller (the use case) must make a deliberate choice about what to
 *  keep rather than have this function quietly drop content. */
export function assertEvidenceExcerptWithinLimit(excerpt: string): void {
  if (excerpt.length > MAX_EVIDENCE_EXCERPT_LENGTH) {
    throw new Error(
      `Evidence excerpt exceeds the ${MAX_EVIDENCE_EXCERPT_LENGTH}-character limit (${excerpt.length} characters). ` +
        "Shorten the excerpt — this module never persists a full captured transcript.",
    );
  }
}
