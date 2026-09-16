/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Phase 5 of the module brief is explicit: do NOT auto-generate a
 * service × city cross-product of pages — each combination must be
 * deliberately reviewed and justified. With exactly six verified service
 * categories (`services.ts`) and exactly one verified location
 * (`locations.ts`), the full cross-product happens to be small (six
 * pairs), but it is still spelled out here explicitly, one entry per
 * pair, rather than computed automatically — so adding a second location
 * later requires a deliberate decision to add pairs here, not an
 * automatic expansion to every service.
 *
 * Justification recorded for every pair below (Phase 5's requirement):
 *  - the service is a real, seeded, ACTIVE top-level `ServiceCategory`;
 *  - the location is a real, seeded `City` (with its `Province`/`Country`);
 *  - `SearchDirectoryUseCase`/`ProfessionalDiscoveryRepository.searchCandidates`
 *    already support filtering by `categoryId` + `city` together (see
 *    `prisma-professional-discovery-repository.ts`), so "request this
 *    service in this location" is a real, working platform capability,
 *    not a page invented to target a keyword;
 *  - `(dashboard)/requests/new` already accepts `categoryId`/`city` as
 *    prefill query params, so the page's CTA links to a real, working
 *    flow, not a dead end.
 *
 * No claim of current professional availability is made on these pages —
 * only that the request/quote flow supports this service in this
 * location (see the Module 118 report, "Structured Data" / "Legal-
 * Business Accuracy Review" for why availability/counts are never
 * stated).
 */

export interface ServiceLocationPair {
  serviceSlug: string;
  locationSlug: string;
}

export const JUSTIFIED_SERVICE_LOCATION_PAIRS: readonly ServiceLocationPair[] = [
  { serviceSlug: "fontaneria", locationSlug: "gandia" },
  { serviceSlug: "electricidad", locationSlug: "gandia" },
  { serviceSlug: "aire-acondicionado", locationSlug: "gandia" },
  { serviceSlug: "pintura", locationSlug: "gandia" },
  { serviceSlug: "reformas", locationSlug: "gandia" },
  { serviceSlug: "montaje-de-muebles", locationSlug: "gandia" },
] as const;

export function isJustifiedServiceLocationPair(serviceSlug: string, locationSlug: string): boolean {
  return JUSTIFIED_SERVICE_LOCATION_PAIRS.some(
    (pair) => pair.serviceSlug === serviceSlug && pair.locationSlug === locationSlug,
  );
}
