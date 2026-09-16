/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Curated, hand-written public content for locations MaestroYa's public
 * knowledge pages describe. Deliberately tiny today: `prisma/seed.ts`'s
 * `seedGeography()` seeds exactly one country → province → city chain
 * (Spain → Valencia → Gandia) via the `Country`/`Province`/`City` Prisma
 * models, and no other city exists in the repository's own seed data.
 *
 * "Playa de Gandia" (mentioned in earlier planning material) is
 * deliberately NOT included here — it is a neighbourhood/beach area of
 * Gandia, not a distinct `City` row in the schema, and the module brief's
 * own non-negotiable rule is "do not assume a location exists simply
 * because it is mentioned in a previous planning document." See the
 * Module 118 report, "Pages Intentionally NOT Created".
 *
 * As with `services.ts`, this file is never trusted on its own: every
 * page that renders an entry here also looks the city up live via Prisma
 * (`Country` → `Province` → `City`) and 404s if it does not find an exact
 * match — so a stale entry here can never cause a page to claim coverage
 * of a place MaestroYa's own data does not have.
 */

export interface LocationContent {
  /** URL slug, e.g. "gandia". */
  slug: string;
  /** Must exactly match a real `City.name` row (case-insensitive compare
   *  performed by the page's live lookup). */
  cityName: string;
  /** Must exactly match that city's `Province.name`. */
  provinceName: string;
  /** Must exactly match that province's `Country.code` (ISO 3166-1 alpha-2). */
  countryCode: string;
  /** Human-readable country name for display copy. */
  countryName: string;
  intro: string;
  faqs: Array<{ question: string; answer: string }>;
  /** Other location slugs to link to — must also exist in this catalog. */
  relatedLocationSlugs: string[];
}

export const LOCATION_CONTENT: readonly LocationContent[] = [
  {
    slug: "gandia",
    cityName: "Gandia",
    provinceName: "Valencia",
    countryCode: "ES",
    countryName: "España",
    intro:
      "Gandia (provincia de Valencia) es la localidad de referencia de MaestroYa. Los clientes en Gandia pueden publicar una solicitud para cualquiera de las categorías de servicio del hogar disponibles en la plataforma, y los profesionales que cubren la zona pueden revisarla y enviar un presupuesto.",
    faqs: [
      {
        question: "¿Qué servicios puedo solicitar en Gandia a través de MaestroYa?",
        answer:
          "Puedes publicar una solicitud para cualquiera de las categorías de servicio del hogar disponibles en MaestroYa (fontanería, electricidad, aire acondicionado, pintura, reformas y montaje de muebles). Consulta la página de cada servicio para ver el detalle.",
      },
      {
        question: "¿Cómo contrato a un profesional en Gandia?",
        answer:
          "Publicas una solicitud describiendo el trabajo. Los profesionales que cubren esa categoría y la zona de Gandia pueden revisarla y enviarte un presupuesto, que puedes comparar y aceptar antes de que empiece el trabajo.",
      },
      {
        question: "¿MaestroYa está disponible fuera de Gandia?",
        answer:
          "Gandia es la localidad con cobertura confirmada hoy en la plataforma. La disponibilidad concreta de profesionales puede variar y depende de quién esté activo en cada momento.",
      },
    ],
    relatedLocationSlugs: [],
  },
] as const;

export function getLocationContentBySlug(slug: string): LocationContent | undefined {
  return LOCATION_CONTENT.find((location) => location.slug === slug);
}
