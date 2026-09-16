/**
 * Module 118 (continuation) — Spain-wide geographic coverage.
 *
 * Curated content for the single national-scope page (`/ubicaciones/espana`).
 * Deliberately separate from `locations.ts` (city-level content) rather
 * than folded into the same catalog/type: a country-level "coverage
 * intent" page and a city-level "verified availability" page make
 * different claims and are verified against different Prisma models
 * (`Country` vs `City`) — conflating them into one shape risked exactly
 * the confusion this continuation exists to remove (see the Module 118
 * report, "Platform Coverage vs. Verified Local Availability").
 *
 * This file states MaestroYa's *business/platform* scope — "MaestroYa is
 * a marketplace that serves customers across Spain" — and is explicit,
 * on every page that renders it, that *actual* local availability is a
 * separate, data-driven question answered by `/ubicaciones/[slug]` pages
 * (currently only Gandia) and by `/servicios/[slug]/[location]` pages.
 * It never states or implies that professionals/companies are currently
 * active in every Spanish municipality, a specific coverage percentage,
 * or any count of professionals, jobs, or customers.
 */

export interface NationalCoverageContent {
  slug: string;
  /** Must exactly match the seeded `Country.code` (ISO 3166-1 alpha-2). */
  countryCode: string;
  /** Must exactly match the seeded `Country.name`. */
  countryName: string;
  /** Display name for Spanish-language copy — the country's own common
   *  name in Spanish, distinct from `Country.name` ("Spain" in English,
   *  as seeded) so page copy reads naturally without renaming the
   *  underlying database value. */
  displayName: string;
  intro: string;
  /** The platform-scope statement, phrased so it can never be read as a
   *  guarantee of current local supply — see the module's non-negotiable
   *  rule 8/9. */
  coverageStatement: string;
  howLocalAvailabilityWorks: string;
  faqs: Array<{ question: string; answer: string }>;
}

export const NATIONAL_COVERAGE_CONTENT: NationalCoverageContent = {
  slug: "espana",
  countryCode: "ES",
  countryName: "Spain",
  displayName: "España",
  intro:
    "MaestroYa es un marketplace de servicios para el hogar que conecta a clientes con profesionales y empresas en España. Cualquier persona en España puede publicar una solicitud de servicio; que un profesional la revise y envíe presupuesto depende de qué profesionales estén activos en esa categoría y esa zona en cada momento.",
  coverageStatement:
    "El alcance de MaestroYa como plataforma es nacional: el objetivo del marketplace es operar en toda España, no solo en una localidad concreta. Esto es distinto de la disponibilidad real de profesionales en una zona determinada, que depende de los datos reales de la plataforma en cada momento.",
  howLocalAvailabilityWorks:
    "Cuando publicas una solicitud, únicamente los profesionales que cubren esa categoría de servicio y tu zona pueden revisarla y enviarte un presupuesto. MaestroYa no garantiza que exista un profesional disponible en cualquier localidad concreta: la disponibilidad real varía según la zona. Las localidades con cobertura confirmada por datos reales de la plataforma tienen su propia página (ver /ubicaciones).",
  faqs: [
    {
      question: "¿MaestroYa opera en toda España?",
      answer:
        "MaestroYa es un marketplace pensado para operar en toda España. Eso no significa que haya profesionales activos ya en cada localidad: la disponibilidad real de profesionales depende de cada zona y puede variar con el tiempo.",
    },
    {
      question: "¿Cómo sé si un servicio está disponible en mi localidad?",
      answer:
        "Puedes publicar una solicitud indicando tu dirección; solo los profesionales que cubran tu categoría y tu zona podrán enviarte un presupuesto. Las localidades con cobertura confirmada por datos reales de la plataforma se listan en la sección de ubicaciones.",
    },
    {
      question: "¿Qué servicios ofrece MaestroYa?",
      answer:
        "MaestroYa publica hoy seis categorías de servicio para el hogar: fontanería, electricidad, aire acondicionado, pintura, reformas y montaje de muebles. Consulta la página de cada servicio para más detalle.",
    },
    {
      question: "¿Cómo participa un profesional en MaestroYa?",
      answer:
        "Un profesional puede crear una cuenta, indicar sus categorías de servicio y la zona que cubre, y a partir de ahí revisar y enviar presupuestos para las solicitudes publicadas que coincidan con su categoría y su zona.",
    },
  ],
};
