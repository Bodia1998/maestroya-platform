import { haversineDistanceKm, isWithinServiceRadius } from "@/domain/services/geo-distance";
import type { ProfessionalDiscoveryCandidate } from "@/domain/repositories/professional-discovery-repository";
import type { ServiceRequestDiscoveryCandidate } from "@/domain/repositories/service-request-discovery-repository";

/**
 * Offers/Quotes module — the single definition of "may this professional
 * respond to this ServiceRequest", reused by CreateQuoteUseCase,
 * GetServiceRequestForProfessionalUseCase, and
 * GetAvailableServiceRequestsForProfessionalUseCase so the eligibility rule
 * can never drift between "can view" and "can quote" — they are exactly
 * the same rule.
 *
 * Deliberately does NOT duplicate Haversine/radius logic — reuses
 * `haversineDistanceKm`/`isWithinServiceRadius` from geo-distance.ts, the
 * same helper SearchProfessionalsUseCase already uses for the mirror-image
 * "which professionals match this search" rule.
 *
 * A professional may respond to a PUBLISHED ServiceRequest when:
 * 1. The request's category is one of the professional's configured
 *    categories.
 * 2. The request has valid coordinates.
 * 3. The professional has a configured serviceRadiusKm.
 * 4. The professional's base address has valid coordinates.
 * 5. The request is within the professional's own service radius.
 *
 * "Is authenticated" / "has an active ProfessionalProfile" / "request is
 * PUBLISHED" / "not the professional's own request" are enforced by the
 * calling use case, not here — those depend on session/ownership context
 * this dependency-free helper deliberately does not take.
 */
export function isProfessionalEligibleForRequest(
  professional: Pick<ProfessionalDiscoveryCandidate, "categoryIds" | "latitude" | "longitude" | "serviceRadiusKm">,
  request: Pick<ServiceRequestDiscoveryCandidate, "categoryId" | "latitude" | "longitude">,
): boolean {
  if (!professional.categoryIds.includes(request.categoryId)) return false;
  if (professional.latitude === null || professional.longitude === null) return false;
  if (professional.serviceRadiusKm === null) return false;
  if (request.latitude === null || request.longitude === null) return false;

  return isWithinServiceRadius(
    { latitude: request.latitude, longitude: request.longitude },
    { latitude: professional.latitude, longitude: professional.longitude },
    professional.serviceRadiusKm,
  );
}

/** Distance in km between the request and the professional's base location,
 *  or null if either side is missing coordinates. Used only for display
 *  (sorting/"X km away") once eligibility has already been established. */
export function distanceToRequestKm(
  professional: Pick<ProfessionalDiscoveryCandidate, "latitude" | "longitude">,
  request: Pick<ServiceRequestDiscoveryCandidate, "latitude" | "longitude">,
): number | null {
  if (professional.latitude === null || professional.longitude === null) return null;
  if (request.latitude === null || request.longitude === null) return null;

  return haversineDistanceKm(
    { latitude: request.latitude, longitude: request.longitude },
    { latitude: professional.latitude, longitude: professional.longitude },
  );
}
