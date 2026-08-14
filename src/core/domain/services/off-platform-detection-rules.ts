/**
 * Module 65 — Trust & Integrity System: off-platform communication /
 * payment detection rule engine. Pure pattern matching over a plain-text
 * body (a Message, Quote note, Review, or ServiceRequest description) —
 * deliberately NOT an AI/LLM classifier (see the module brief's explicit
 * "DO NOT integrate AI" instruction): every rule here is a named,
 * reviewable regular expression or keyword list, so a false positive can
 * be root-caused and fixed by editing one pattern, not by re-prompting a
 * model. `application/ports/off-platform-detection-provider.ts` wraps this
 * engine behind a provider interface so a future, smarter backend (a
 * managed content-classification API) can be swapped in without changing
 * any call site — see that port's own doc comment.
 *
 * Every pattern is deliberately permissive (favors recall over precision)
 * — this module never takes an irreversible action off a single match (see
 * `trust-integrity-action-policy.ts`), so a false positive costs at most
 * one low-severity `OffPlatformDetectionEvent` a human can dismiss.
 */
import type { OffPlatformChannel } from "@/domain/repositories/off-platform-detection-repository";

export interface OffPlatformSignal {
  channel: OffPlatformChannel;
  /** The exact substring that matched, truncated to 200 chars — persisted
   *  verbatim on `OffPlatformDetectionEvent.matchedText` (itself capped at
   *  500 chars at the schema level). */
  matchedText: string;
  /** 0-100 — how confident this single rule is that this is a genuine
   *  off-platform attempt (a bare 9-digit number is lower-confidence than
   *  an explicit "add me on WhatsApp"). */
  confidence: number;
}

interface ChannelRule {
  channel: OffPlatformChannel;
  pattern: RegExp;
  confidence: number;
}

// Patterns are intentionally case-insensitive and tolerant of basic
// evasion (spaced-out letters, leetspeak digits) for the highest-value
// channels; lower-value/rarer channels use a simpler literal match.
const CHANNEL_RULES: ChannelRule[] = [
  { channel: "WHATSAPP", pattern: /wh[a4]ts\s*[a4]pp|w\.?a\.?\s*me|\bwsp\b/i, confidence: 90 },
  { channel: "TELEGRAM", pattern: /t[e3]l[e3]gr[a4]m|\bt\.me\/|\btg\b\s*[:@]/i, confidence: 85 },
  { channel: "SIGNAL", pattern: /\bsignal\s*(app|me|number)?\b/i, confidence: 60 },
  { channel: "INSTAGRAM", pattern: /\binst[a4]gr[a4]m\b|\big\s*[:@]|\binsta\b/i, confidence: 75 },
  { channel: "FACEBOOK", pattern: /\bf[a4]c[e3]book\b|\bfb\s*[:@]|\bmessenger\b/i, confidence: 70 },
  { channel: "TIKTOK", pattern: /\btik\s*tok\b/i, confidence: 60 },
  { channel: "DISCORD", pattern: /\bdiscord\b/i, confidence: 70 },
  { channel: "SKYPE", pattern: /\bskype\b/i, confidence: 70 },
  // A run of 7+ digits (allowing spaces/dashes/dots as separators) — most
  // phone numbers regardless of country format; a bare number alone is
  // lower confidence than a named messaging app.
  { channel: "PHONE_NUMBER", pattern: /(?:\+?\d[\d\s.\-]{6,}\d)/, confidence: 55 },
  { channel: "EMAIL_ADDRESS", pattern: /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-z0-9.-]+\s*(?:\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i, confidence: 80 },
  {
    channel: "EXTERNAL_PAYMENT_REQUEST",
    pattern: /pay\s*me\s*(directly|cash|outside)|p[aá]game\s*(directamente|en\s*efectivo)|bizum\b|western\s*union|cash\s*only|efectivo\s*(directo|sin\s*factura)/i,
    confidence: 85,
  },
  {
    channel: "CONTACT_EXCHANGE_PHRASE",
    pattern: /let'?s\s*(continue|talk|move)\s*(this\s*)?outside|contact\s*me\s*(directly|off\s*(the\s*)?platform)|fuera\s*de\s*la\s*plataforma|hablemos\s*por\s*fuera|call\s*me\s*directly|text\s*me\s*at/i,
    confidence: 80,
  },
];

/** Cap enforced on every persisted `matchedText` — mirrors the schema's
 *  own `VarChar(500)` column with headroom for a shorter, human-scannable
 *  excerpt (200 chars is plenty to show intent to a reviewing admin). */
const MAX_MATCHED_TEXT_LENGTH = 200;

/**
 * Runs every channel rule against `text` and returns one `OffPlatformSignal`
 * per distinct channel matched (a channel that matches multiple times only
 * contributes its first, highest-context match — deduping is the caller's
 * business-value decision to make, not this engine's; see
 * `DetectOffPlatformCommunicationUseCase`, which persists one
 * `OffPlatformDetectionEvent` row per returned signal).
 */
export function detectOffPlatformSignals(text: string): OffPlatformSignal[] {
  if (!text || text.trim().length === 0) return [];

  const signals: OffPlatformSignal[] = [];
  for (const rule of CHANNEL_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    signals.push({
      channel: rule.channel,
      matchedText: match[0].slice(0, MAX_MATCHED_TEXT_LENGTH),
      confidence: rule.confidence,
    });
  }
  return signals;
}

/** True when at least one high-confidence (>= 75) signal was detected —
 *  the threshold `detect-off-platform-communication.use-case.ts` uses to
 *  decide whether to feed a `RISK_SCORE`-moving event, versus logging a
 *  low-confidence signal for visibility only. */
export function hasHighConfidenceSignal(signals: readonly OffPlatformSignal[]): boolean {
  return signals.some((s) => s.confidence >= 75);
}
