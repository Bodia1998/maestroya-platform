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
  /** One-paragraph, factual introduction — no marketing superlatives. */
  intro: string;
  /** Concrete, generic examples of jobs a customer can request in this
   *  category. Always phrased as "can request", never "guaranteed". */
  commonJobTypes: string[];
  /** What a professional who takes this kind of job typically brings /
   *  covers — generic trade knowledge, never a MaestroYa-specific
   *  guarantee (no insurance/certification/licensing claims). */
  whatProfessionalsTypicallyProvide: string[];
  /** Things worth deciding/preparing before publishing a request — tied
   *  to real platform fields (photos, urgency, budget range), not
   *  invented advice. */
  considerations: string[];
  /** Genuine, answerable-from-the-page FAQ. */
  faqs: Array<{ question: string; answer: string }>;
  /** Other service slugs to link to from this page — must also exist in
   *  this same catalog. */
  relatedServiceSlugs: string[];
}

export const SERVICE_CONTENT: readonly ServiceContent[] = [
  {
    slug: "fontaneria",
    intro:
      "MaestroYa conecta a clientes con profesionales para trabajos de fontanería: reparación de fugas, grifos, tuberías e instalaciones de agua en el hogar. El cliente describe el problema y publica una solicitud; los profesionales de fontanería que cubren la zona pueden revisarla y enviar un presupuesto.",
    commonJobTypes: [
      "Reparación de fugas de agua",
      "Sustitución o reparación de grifos",
      "Desatasco de tuberías",
      "Instalación de sanitarios (inodoros, lavabos, duchas)",
      "Revisión o reparación de termos e instalaciones de agua caliente",
    ],
    whatProfessionalsTypicallyProvide: [
      "Diagnóstico del problema descrito en la solicitud",
      "Un presupuesto detallado antes de empezar el trabajo",
      "La realización del trabajo acordado en el presupuesto aceptado",
    ],
    considerations: [
      "Describe el problema con el mayor detalle posible y añade fotos a la solicitud si es posible",
      "Indica la urgencia real del trabajo (el sistema permite marcar solicitudes como más o menos urgentes)",
      "Puedes recibir y comparar varios presupuestos antes de aceptar uno",
    ],
    faqs: [
      {
        question: "¿Qué tipo de trabajos de fontanería puedo solicitar en MaestroYa?",
        answer:
          "Puedes publicar una solicitud describiendo cualquier trabajo de fontanería para el hogar, como una fuga, un grifo que no funciona o la instalación de un sanitario. Los profesionales de fontanería que cubren tu zona pueden revisar la solicitud y enviarte un presupuesto.",
      },
      {
        question: "¿Cómo funciona el presupuesto de fontanería?",
        answer:
          "Después de publicar tu solicitud, uno o varios profesionales pueden enviarte un presupuesto. Puedes comparar los presupuestos recibidos y aceptar el que prefieras antes de que empiece el trabajo.",
      },
      {
        question: "¿En qué zonas está disponible el servicio de fontanería?",
        answer:
          "La cobertura depende de los profesionales activos en cada zona. Consulta la página de tu localidad para ver la disponibilidad actual en esa zona.",
      },
    ],
    relatedServiceSlugs: ["electricidad", "reformas"],
  },
  {
    slug: "electricidad",
    intro:
      "MaestroYa conecta a clientes con profesionales para trabajos de electricidad: instalaciones eléctricas, averías, cuadros eléctricos y enchufes. El cliente describe el trabajo y publica una solicitud; los profesionales de electricidad que cubren la zona pueden revisarla y enviar un presupuesto.",
    commonJobTypes: [
      "Reparación de averías eléctricas",
      "Instalación o sustitución de enchufes e interruptores",
      "Revisión o actualización del cuadro eléctrico",
      "Instalación de puntos de luz",
      "Instalación de mecanismos y pequeña electricidad doméstica",
    ],
    whatProfessionalsTypicallyProvide: [
      "Diagnóstico del problema eléctrico descrito en la solicitud",
      "Un presupuesto detallado antes de empezar el trabajo",
      "La realización del trabajo acordado en el presupuesto aceptado",
    ],
    considerations: [
      "Describe la avería o instalación con el mayor detalle posible, con fotos si ayuda a explicarla",
      "Indica la urgencia real del trabajo",
      "Compara varios presupuestos antes de aceptar uno",
    ],
    faqs: [
      {
        question: "¿Qué tipo de trabajos de electricidad puedo solicitar en MaestroYa?",
        answer:
          "Puedes publicar una solicitud para averías eléctricas, instalación de enchufes o puntos de luz, o revisión del cuadro eléctrico, entre otros trabajos. Los profesionales de electricidad que cubren tu zona pueden enviarte un presupuesto.",
      },
      {
        question: "¿Cómo solicito un electricista a través de MaestroYa?",
        answer:
          "Publica una solicitud describiendo el trabajo. Los profesionales que cubren tu categoría y zona podrán revisarla y enviarte un presupuesto, que puedes aceptar o rechazar.",
      },
      {
        question: "¿En qué zonas está disponible el servicio de electricidad?",
        answer:
          "La cobertura depende de los profesionales activos en cada zona. Consulta la página de tu localidad para ver la disponibilidad actual en esa zona.",
      },
    ],
    relatedServiceSlugs: ["fontaneria", "aire-acondicionado"],
  },
  {
    slug: "aire-acondicionado",
    intro:
      "MaestroYa conecta a clientes con profesionales para trabajos de climatización: instalación, mantenimiento y reparación de aire acondicionado. El cliente describe lo que necesita y publica una solicitud; los técnicos de climatización que cubren la zona pueden revisarla y enviar un presupuesto.",
    commonJobTypes: [
      "Instalación de un nuevo equipo de aire acondicionado",
      "Reparación de un equipo que no enfría o no funciona",
      "Mantenimiento y limpieza de equipos",
      "Recarga de gas refrigerante",
    ],
    whatProfessionalsTypicallyProvide: [
      "Diagnóstico o valoración del equipo o instalación descrita en la solicitud",
      "Un presupuesto detallado antes de empezar el trabajo",
      "La realización del trabajo acordado en el presupuesto aceptado",
    ],
    considerations: [
      "Indica el tipo de equipo (si lo conoces) y describe el problema o la instalación deseada",
      "Añade fotos del equipo o del espacio si ayuda a explicar el trabajo",
      "Compara varios presupuestos antes de aceptar uno",
    ],
    faqs: [
      {
        question: "¿Qué trabajos de climatización puedo solicitar en MaestroYa?",
        answer:
          "Puedes solicitar instalación, reparación o mantenimiento de aire acondicionado. Los técnicos de climatización que cubren tu zona pueden revisar tu solicitud y enviarte un presupuesto.",
      },
      {
        question: "¿Cómo funciona el presupuesto para instalar aire acondicionado?",
        answer:
          "Publicas tu solicitud describiendo lo que necesitas; los profesionales interesados envían su presupuesto y tú decides cuál aceptar.",
      },
      {
        question: "¿En qué zonas está disponible el servicio de aire acondicionado?",
        answer:
          "La cobertura depende de los profesionales activos en cada zona. Consulta la página de tu localidad para ver la disponibilidad actual en esa zona.",
      },
    ],
    relatedServiceSlugs: ["electricidad", "reformas"],
  },
  {
    slug: "pintura",
    intro:
      "MaestroYa conecta a clientes con profesionales de pintura para trabajos de interior y exterior. El cliente describe el espacio a pintar y publica una solicitud; los profesionales de pintura que cubren la zona pueden revisarla y enviar un presupuesto.",
    commonJobTypes: [
      "Pintura de interiores (habitaciones, pasillos, techos)",
      "Pintura de fachadas y exteriores",
      "Alisado y preparación de paredes antes de pintar",
      "Retoques y acabados puntuales",
    ],
    whatProfessionalsTypicallyProvide: [
      "Valoración del espacio y del trabajo descrito en la solicitud",
      "Un presupuesto detallado antes de empezar el trabajo",
      "La realización del trabajo acordado en el presupuesto aceptado",
    ],
    considerations: [
      "Indica la superficie aproximada y el estado actual de las paredes",
      "Añade fotos del espacio a pintar",
      "Compara varios presupuestos antes de aceptar uno",
    ],
    faqs: [
      {
        question: "¿Qué trabajos de pintura puedo solicitar en MaestroYa?",
        answer:
          "Puedes solicitar pintura de interiores, exteriores o retoques puntuales. Los profesionales de pintura que cubren tu zona pueden enviarte un presupuesto.",
      },
      {
        question: "¿Cómo funciona el presupuesto de pintura?",
        answer:
          "Publicas tu solicitud describiendo el espacio y el trabajo; los profesionales interesados envían su presupuesto y tú decides cuál aceptar.",
      },
      {
        question: "¿En qué zonas está disponible el servicio de pintura?",
        answer:
          "La cobertura depende de los profesionales activos en cada zona. Consulta la página de tu localidad para ver la disponibilidad actual en esa zona.",
      },
    ],
    relatedServiceSlugs: ["reformas", "montaje-de-muebles"],
  },
  {
    slug: "reformas",
    intro:
      "MaestroYa conecta a clientes con profesionales para reformas integrales y parciales del hogar. El cliente describe el alcance de la reforma y publica una solicitud; los profesionales de reformas que cubren la zona pueden revisarla y enviar un presupuesto.",
    commonJobTypes: [
      "Reformas parciales (una habitación, un baño, una cocina)",
      "Reformas integrales de vivienda",
      "Trabajos de albañilería asociados a una reforma",
      "Cambios de distribución o acabados",
    ],
    whatProfessionalsTypicallyProvide: [
      "Valoración del alcance de la reforma descrita en la solicitud",
      "Un presupuesto detallado antes de empezar el trabajo",
      "La realización del trabajo acordado en el presupuesto aceptado",
    ],
    considerations: [
      "Describe el alcance de la reforma con el mayor detalle posible",
      "Añade fotos del estado actual del espacio",
      "Las reformas suelen implicar presupuestos más elevados: compara varias opciones antes de aceptar",
    ],
    faqs: [
      {
        question: "¿Qué tipo de reformas puedo solicitar en MaestroYa?",
        answer:
          "Puedes solicitar reformas parciales o integrales del hogar. Los profesionales de reformas que cubren tu zona pueden revisar tu solicitud y enviarte un presupuesto.",
      },
      {
        question: "¿Puedo comparar varios presupuestos de reforma?",
        answer:
          "Sí. Puedes recibir presupuestos de varios profesionales para la misma solicitud y comparar antes de aceptar uno.",
      },
      {
        question: "¿En qué zonas está disponible el servicio de reformas?",
        answer:
          "La cobertura depende de los profesionales activos en cada zona. Consulta la página de tu localidad para ver la disponibilidad actual en esa zona.",
      },
    ],
    relatedServiceSlugs: ["pintura", "fontaneria"],
  },
  {
    slug: "montaje-de-muebles",
    intro:
      "MaestroYa conecta a clientes con profesionales para el montaje y ensamblaje de muebles y mobiliario. El cliente describe el mueble o los muebles a montar y publica una solicitud; los profesionales de montaje que cubren la zona pueden revisarla y enviar un presupuesto.",
    commonJobTypes: [
      "Montaje de muebles de kit (armarios, estanterías, mesas)",
      "Montaje de mobiliario de cocina",
      "Fijación de muebles a pared",
      "Ensamblaje de varios muebles en una misma visita",
    ],
    whatProfessionalsTypicallyProvide: [
      "Valoración del mueble o muebles descritos en la solicitud",
      "Un presupuesto antes de empezar el montaje",
      "La realización del montaje acordado en el presupuesto aceptado",
    ],
    considerations: [
      "Indica el tipo y la cantidad de muebles a montar",
      "Añade fotos de las cajas o del manual si lo tienes",
      "Compara varios presupuestos antes de aceptar uno",
    ],
    faqs: [
      {
        question: "¿Qué muebles puedo pedir que me monten en MaestroYa?",
        answer:
          "Puedes solicitar el montaje de prácticamente cualquier mueble de kit, como armarios, estanterías o mobiliario de cocina. Los profesionales de montaje que cubren tu zona pueden enviarte un presupuesto.",
      },
      {
        question: "¿Cómo funciona el presupuesto de montaje de muebles?",
        answer:
          "Publicas tu solicitud describiendo el mueble o muebles a montar; los profesionales interesados envían su presupuesto y tú decides cuál aceptar.",
      },
      {
        question: "¿En qué zonas está disponible el servicio de montaje de muebles?",
        answer:
          "La cobertura depende de los profesionales activos en cada zona. Consulta la página de tu localidad para ver la disponibilidad actual en esa zona.",
      },
    ],
    relatedServiceSlugs: ["pintura", "fontaneria"],
  },
] as const;

export function getServiceContentBySlug(slug: string): ServiceContent | undefined {
  return SERVICE_CONTENT.find((service) => service.slug === slug);
}
