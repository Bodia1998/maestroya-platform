/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Curated, hand-written public content for MaestroYa's top-level service
 * categories. This is deliberately a small, static, typed catalog — not a
 * new database model — because this copy (introduction, common job types,
 * FAQ wording) is editorial content a person writes and reviews, not data
 * that changes per request. See `docs/` / the Module 118 report,
 * "Content Source of Truth" for the full reasoning.
 *
 * Every `slug` below MUST correspond to a real, top-level (`parentId:
 * null`), `ACTIVE` `ServiceCategory` row — see `prisma/seed.ts`'s
 * `SERVICE_CATEGORIES` for the six categories this platform actually
 * seeds (Fontanería, Electricidad, Aire acondicionado, Pintura, Reformas,
 * Montaje de muebles). This file is never trusted on its own: every page
 * that renders an entry from here (`(marketing)/servicios/[slug]`) also
 * looks the slug up live in the database and 404s if no matching, active,
 * top-level category exists — so a stale or renamed entry here can never
 * cause a page to publish content for a service MaestroYa doesn't
 * actually offer. Do not add an entry for a service that is not a real,
 * seeded `ServiceCategory` — see the Module 118 report, "Pages
 * Intentionally NOT Created" for services considered and excluded (e.g.
 * "Repairs" — mentioned in planning documents but not a seeded category).
 *
 * Module 120 — Multilingual Localization: this file keeps the typed
 * STRUCTURE (slugs, which entries exist, related slugs); the prose itself
 * lives once, in the server-only `knowledge` message namespace
 * (`src/i18n/messages/<locale>/knowledge.json`, keyed
 * `services.<slug>.…`, Spanish = the original, reviewed copy) and is
 * resolved for the active locale by `resolveServiceContent()` below.
 * Every translation must follow the same content rules — translating
 * never adds, strengthens or softens a claim.
 *
 * Content rules (Module 118 brief, Phase 3 / Phase 7):
 *  - No prices, response times, guarantees, availability counts,
 *    professional counts, ratings, review counts, insurance, licensing,
 *    certification, or emergency/24-7 claims.
 *  - Every process claim (publish a request, receive quotes, compare and
 *    accept, schedule an appointment, mark the job complete) mirrors the
 *    real domain model: `ServiceRequest` → `Quote` → `Job` →
 *    `Appointment` → `JobCompletionConfirmation` (see `prisma/schema.prisma`).
 *  - `commonJobTypes` are generic, well-understood examples of the trade
 *    (a plumber repairs leaks; en electrician installs sockets) — not a
 *    claim that any specific job is guaranteed available.
 */

export interface ServiceContent {
  /** Must match a real `ServiceCategory.slug` (see `prisma/seed.ts`). */
  slug: string;
  /** Keys under `knowledge.services.<slug>.commonJobTypes` — concrete,
   *  generic examples of jobs a customer can request in this category.
   *  Always phrased as "can request", never "guaranteed". */
  commonJobTypes: readonly string[];
  /** Keys under `knowledge.services.<slug>.whatProfessionalsTypicallyProvide`
   *  — generic trade knowledge, never a MaestroYa-specific guarantee (no
   *  insurance/certification/licensing claims). */
  whatProfessionalsTypicallyProvide: readonly string[];
  /** Keys under `knowledge.services.<slug>.considerations` — things worth
   *  deciding/preparing before publishing a request, tied to real
   *  platform fields (photos, urgency, budget range). */
  considerations: readonly string[];
  /** Keys under `knowledge.services.<slug>.faqs` (each with a `question`
   *  and an `answer`) — genuine, answerable-from-the-page FAQ. */
  faqs: readonly string[];
  /** Other service slugs to link to from this page — must also exist in
   *  this same catalog. */
  relatedServiceSlugs: readonly string[];
}

/** Also defined per slug in the `knowledge` catalog: `intro` (one factual
 *  paragraph, no marketing superlatives) and `nameInSentence` (the
 *  category name in the form that locale's sentences embed it, e.g.
 *  "fontanería" in "una solicitud de fontanería"). */
export const SERVICE_CONTENT: readonly ServiceContent[] = [
  {
    slug: "fontaneria",
    commonJobTypes: [
      "leakRepair",
      "tapRepair",
      "pipeUnblocking",
      "sanitaryInstallation",
      "waterHeaterRepair",
    ],
    whatProfessionalsTypicallyProvide: ["diagnosis", "quote", "execution"],
    considerations: ["describe", "urgency", "compare"],
    faqs: ["whatJobs", "howQuote", "coverage"],
    relatedServiceSlugs: ["electricidad", "reformas"],
  },
  {
    slug: "electricidad",
    commonJobTypes: [
      "faultRepair",
      "socketsSwitches",
      "panelUpgrade",
      "lightPoints",
      "smallInstallations",
    ],
    whatProfessionalsTypicallyProvide: ["diagnosis", "quote", "execution"],
    considerations: ["describe", "urgency", "compare"],
    faqs: ["whatJobs", "howToRequest", "coverage"],
    relatedServiceSlugs: ["fontaneria", "aire-acondicionado"],
  },
  {
    slug: "aire-acondicionado",
    commonJobTypes: ["newInstallation", "repair", "maintenance", "gasRecharge"],
    whatProfessionalsTypicallyProvide: ["assessment", "quote", "execution"],
    considerations: ["equipmentType", "photos", "compare"],
    faqs: ["whatJobs", "howQuote", "coverage"],
    relatedServiceSlugs: ["electricidad", "reformas"],
  },
  {
    slug: "pintura",
    commonJobTypes: ["interior", "exterior", "wallPreparation", "touchUps"],
    whatProfessionalsTypicallyProvide: ["assessment", "quote", "execution"],
    considerations: ["surface", "photos", "compare"],
    faqs: ["whatJobs", "howQuote", "coverage"],
    relatedServiceSlugs: ["reformas", "montaje-de-muebles"],
  },
  {
    slug: "reformas",
    commonJobTypes: ["partial", "full", "masonry", "layoutFinishes"],
    whatProfessionalsTypicallyProvide: ["assessment", "quote", "execution"],
    considerations: ["scope", "photos", "compare"],
    faqs: ["whatJobs", "compareQuotes", "coverage"],
    relatedServiceSlugs: ["pintura", "fontaneria"],
  },
  {
    slug: "montaje-de-muebles",
    commonJobTypes: ["flatPack", "kitchen", "wallFixing", "multiple"],
    whatProfessionalsTypicallyProvide: ["assessment", "quote", "execution"],
    considerations: ["typeQuantity", "photos", "compare"],
    faqs: ["whatFurniture", "howQuote", "coverage"],
    relatedServiceSlugs: ["pintura", "fontaneria"],
  },
] as const;

export function getServiceContentBySlug(slug: string): ServiceContent | undefined {
  return SERVICE_CONTENT.find((service) => service.slug === slug);
}

/** The minimal translator shape the resolvers need: `t(key)` bound to the
 *  `knowledge` namespace (a next-intl translator from
 *  `getTranslations("knowledge")`, or `createTranslator` for a fixed
 *  locale). Typed loosely because the keys are built from slugs. */
export type KnowledgeTranslator = (key: string) => string;

export interface FaqEntry {
  question: string;
  answer: string;
}

/** `ServiceContent` with every key resolved to text in one locale. */
export interface ResolvedServiceContent {
  slug: string;
  intro: string;
  /** Category name as it reads inside that locale's sentences. */
  nameInSentence: string;
  commonJobTypes: string[];
  whatProfessionalsTypicallyProvide: string[];
  considerations: string[];
  faqs: FaqEntry[];
  relatedServiceSlugs: readonly string[];
}

export function resolveServiceContent(content: ServiceContent, t: unknown): ResolvedServiceContent {
  const translate = t as KnowledgeTranslator;
  const base = `services.${content.slug}`;
  return {
    slug: content.slug,
    intro: translate(`${base}.intro`),
    nameInSentence: translate(`${base}.nameInSentence`),
    commonJobTypes: content.commonJobTypes.map((key) => translate(`${base}.commonJobTypes.${key}`)),
    whatProfessionalsTypicallyProvide: content.whatProfessionalsTypicallyProvide.map((key) =>
      translate(`${base}.whatProfessionalsTypicallyProvide.${key}`),
    ),
    considerations: content.considerations.map((key) => translate(`${base}.considerations.${key}`)),
    faqs: content.faqs.map((key) => ({
      question: translate(`${base}.faqs.${key}.question`),
      answer: translate(`${base}.faqs.${key}.answer`),
    })),
    relatedServiceSlugs: content.relatedServiceSlugs,
  };
}
