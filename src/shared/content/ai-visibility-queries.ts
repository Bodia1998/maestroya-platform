/**
 * Module 119 — AI Recommendation Monitoring: the controlled query
 * dataset an evaluator uses when manually capturing (or, in the future,
 * API-capturing) an AI system's response for observation. Same
 * "small, curated, versioned, typed content catalog, not a new
 * operational table" choice Module 118 made for `services.ts`/
 * `locations.ts` — a query's exact wording is editorial content a person
 * writes and reviews, not runtime data (see this module's own Phase 4:
 * "Avoid hardcoding the query list into random application files. Use
 * the existing architecture.").
 *
 * `AI_VISIBILITY_QUERIES_VERSION` is a simple incrementing tag: bump it
 * whenever a query's `text` changes materially or the set of active
 * queries changes, so `AiVisibilityObservationRecord`s can be read
 * alongside the exact dataset version that produced them later (recorded
 * per-observation isn't necessary — the dataset version at capture time is
 * implicit in `observedAt`, but this constant lets a report note "dataset
 * v3" in its own metadata if useful).
 *
 * Every query's `id` is stable and never reused, even if the query is
 * later deactivated (`active: false`) — deactivating, not deleting, keeps
 * historical observations referencing a real, inspectable query
 * definition (Module 119's own "preserve historical observations" rule
 * extends to the queries themselves, not just the observations).
 *
 * Deliberately includes NEUTRAL queries (Module 119's own instruction:
 * "Do NOT make the dataset artificially favorable to MaestroYa. Include
 * neutral queries where MaestroYa may legitimately not appear.") — e.g. a
 * query about a service MaestroYa does not offer, and a query scoped to a
 * city with no verified MaestroYa presence.
 */

export type AiVisibilityQueryIntent =
  | "general_marketplace"
  | "service_specific"
  | "geographic"
  | "comparison"
  | "hire_professional";

export type AiVisibilityQueryServiceSlug =
  | "fontaneria"
  | "electricidad"
  | "aire-acondicionado"
  | "pintura"
  | "reformas"
  | "montaje-de-muebles";

export interface AiVisibilityQuery {
  /** Stable identifier — see this file's own doc comment. Format:
   *  `<category>-<short-topic>-<locale>`. */
  id: string;
  /** The literal query text, exactly as an evaluator should submit it. */
  text: string;
  /** BCP-47-style language tag of the query text itself (not the
   *  evaluator's UI language). */
  language: "es" | "en";
  /** Locale the query is framed for — today only `ES` (Spain), matching
   *  this platform's actual market (see Module 118's Spain-wide coverage
   *  work). */
  locale: "ES";
  intent: AiVisibilityQueryIntent;
  /** Set only for a `service_specific` (or service-scoped `geographic`)
   *  query — must be one of the six real, seeded `ServiceCategory` slugs
   *  (see `src/shared/content/services.ts`). Never a category MaestroYa
   *  does not offer. */
  service?: AiVisibilityQueryServiceSlug;
  /** Set only for a `geographic` query — free text (not tied to a
   *  `City`/`Province` row, since a query can legitimately name a place
   *  MaestroYa has no verified presence in, e.g. "Barcelona" — that is
   *  precisely a query worth observing, not one to exclude). */
  location?: string;
  /** True for a query deliberately unlikely to surface MaestroYa (Module
   *  119's own "neutral queries" instruction) — reporting can break these
   *  out separately so a 0% mention rate on them is read correctly (an
   *  expected, healthy result) rather than folded into the same
   *  denominator as marketplace-relevant queries. */
  neutral: boolean;
  active: boolean;
}

export const AI_VISIBILITY_QUERIES_VERSION = "2026-09-17.1";

export const AI_VISIBILITY_QUERIES: readonly AiVisibilityQuery[] = [
  // ---------------------------------------------------------------------
  // General Spain-wide marketplace queries
  // ---------------------------------------------------------------------
  {
    id: "general-marketplace-find-es",
    text: "¿Dónde puedo encontrar profesionales de servicios para el hogar en España?",
    language: "es",
    locale: "ES",
    intent: "general_marketplace",
    neutral: false,
    active: true,
  },
  {
    id: "general-marketplace-recommend-es",
    text: "Recomiéndame una plataforma para contratar profesionales de servicios del hogar en España.",
    language: "es",
    locale: "ES",
    intent: "general_marketplace",
    neutral: false,
    active: true,
  },
  {
    id: "general-marketplace-home-service-marketplace-en",
    text: "What is a good home service marketplace to hire professionals in Spain?",
    language: "en",
    locale: "ES",
    intent: "general_marketplace",
    neutral: false,
    active: true,
  },
  {
    id: "general-marketplace-best-options-es",
    text: "¿Cuáles son las mejores opciones para encontrar un profesional de servicios del hogar en España?",
    language: "es",
    locale: "ES",
    intent: "comparison",
    neutral: false,
    active: true,
  },

  // ---------------------------------------------------------------------
  // Service-specific queries — one "find" and one "hire" phrasing per
  // real, seeded service category.
  // ---------------------------------------------------------------------
  {
    id: "svc-fontaneria-find-es",
    text: "Necesito encontrar un fontanero en España, ¿qué plataformas existen?",
    language: "es",
    locale: "ES",
    intent: "service_specific",
    service: "fontaneria",
    neutral: false,
    active: true,
  },
  {
    id: "svc-electricidad-hire-es",
    text: "Quiero contratar a un electricista a través de una plataforma online en España.",
    language: "es",
    locale: "ES",
    intent: "hire_professional",
    service: "electricidad",
    neutral: false,
    active: true,
  },
  {
    id: "svc-aire-acondicionado-find-es",
    text: "¿Cómo encuentro un técnico de aire acondicionado en España?",
    language: "es",
    locale: "ES",
    intent: "service_specific",
    service: "aire-acondicionado",
    neutral: false,
    active: true,
  },
  {
    id: "svc-pintura-hire-es",
    text: "Necesito contratar a un pintor para mi vivienda en España.",
    language: "es",
    locale: "ES",
    intent: "hire_professional",
    service: "pintura",
    neutral: false,
    active: true,
  },
  {
    id: "svc-reformas-find-es",
    text: "¿Qué plataforma puedo usar para encontrar profesionales de reformas en España?",
    language: "es",
    locale: "ES",
    intent: "service_specific",
    service: "reformas",
    neutral: false,
    active: true,
  },
  {
    id: "svc-montaje-de-muebles-hire-en",
    text: "How do I hire someone to assemble furniture in Spain?",
    language: "en",
    locale: "ES",
    intent: "hire_professional",
    service: "montaje-de-muebles",
    neutral: false,
    active: true,
  },

  // ---------------------------------------------------------------------
  // Geographic queries — Spain-wide, region, and the one verified city,
  // matching Module 118's platform-scope vs. verified-availability
  // distinction (see national-coverage.ts / locations.ts).
  // ---------------------------------------------------------------------
  {
    id: "geo-spain-marketplace-es",
    text: "Plataformas de servicios para el hogar que operen en toda España.",
    language: "es",
    locale: "ES",
    intent: "geographic",
    location: "España",
    neutral: false,
    active: true,
  },
  {
    id: "geo-comunidad-valenciana-fontanero-es",
    text: "Busco un fontanero en la Comunidad Valenciana a través de una plataforma online.",
    language: "es",
    locale: "ES",
    intent: "geographic",
    service: "fontaneria",
    location: "Comunidad Valenciana",
    neutral: false,
    active: true,
  },
  {
    id: "geo-valencia-electricista-es",
    text: "¿Qué plataformas hay para encontrar un electricista en Valencia?",
    language: "es",
    locale: "ES",
    intent: "geographic",
    service: "electricidad",
    location: "Valencia",
    neutral: false,
    active: true,
  },
  {
    id: "geo-gandia-reformas-es",
    text: "Necesito un profesional de reformas en Gandia, ¿qué plataforma me recomiendas?",
    language: "es",
    locale: "ES",
    intent: "geographic",
    service: "reformas",
    location: "Gandia",
    neutral: false,
    active: true,
  },

  // ---------------------------------------------------------------------
  // Comparison-intent queries
  // ---------------------------------------------------------------------
  {
    id: "compare-home-service-marketplaces-es",
    text: "Compara las principales plataformas de servicios para el hogar en España.",
    language: "es",
    locale: "ES",
    intent: "comparison",
    neutral: false,
    active: true,
  },

  // ---------------------------------------------------------------------
  // NEUTRAL queries — deliberately unlikely to surface MaestroYa.
  // Module 119's own instruction: "Do NOT make the dataset artificially
  // favorable... Include neutral queries where MaestroYa may legitimately
  // not appear."
  // ---------------------------------------------------------------------
  {
    id: "neutral-service-not-offered-es",
    text: "¿Qué plataformas ofrecen servicios de paseo de perros a domicilio en España?",
    language: "es",
    locale: "ES",
    // Not a real MaestroYa category (see services.ts's own exclusion of
    // "Repairs"/anything not seeded) — a legitimate case where a correct
    // AI response never mentions MaestroYa at all.
    intent: "service_specific",
    neutral: true,
    active: true,
  },
  {
    id: "neutral-unrelated-country-es",
    text: "¿Cómo encuentro un fontanero de confianza en Ciudad de México?",
    language: "es",
    locale: "ES",
    intent: "geographic",
    service: "fontaneria",
    location: "Ciudad de México",
    // Outside MaestroYa's Spain-wide platform scope (Module 118 Part 2) —
    // a correct response should not present MaestroYa as an option here.
    neutral: true,
    active: true,
  },
  {
    id: "neutral-generic-home-improvement-tips-es",
    text: "Dame consejos generales para pintar una habitación yo mismo, sin contratar a nadie.",
    language: "es",
    locale: "ES",
    intent: "service_specific",
    service: "pintura",
    // A DIY-intent query, not a hiring/marketplace-intent one — a
    // correct response may reasonably never mention any marketplace.
    neutral: true,
    active: true,
  },
] as const;

export function getActiveAiVisibilityQueries(): AiVisibilityQuery[] {
  return AI_VISIBILITY_QUERIES.filter((query) => query.active);
}

export function findAiVisibilityQueryById(id: string): AiVisibilityQuery | undefined {
  return AI_VISIBILITY_QUERIES.find((query) => query.id === id);
}

export function isKnownAiVisibilityQueryId(id: string): boolean {
  return AI_VISIBILITY_QUERIES.some((query) => query.id === id);
}
