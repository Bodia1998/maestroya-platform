"use server";

import { reverseGeocodeSchema } from "@/application/dto/geolocation.dto";
import { makeReverseGeocodeUseCase } from "@/application/use-cases/geolocation/compose";
import { logger } from "@/infrastructure/observability/logger";

export type ReverseGeocodeActionResult =
  | { success: true; address: string | null; latitude: number; longitude: number }
  | { success: false; error: string };

/**
 * Module 42 — Geocoding & Maps.
 *
 * Server Action backing the interactive map's "click a point" / "use my
 * current location" address preview — the client-side map component
 * (`InteractiveMap`, `SearchResultsMap`) never calls a geocoding vendor or
 * `GeocodingProvider` directly; every coordinate a browser produces is
 * validated here (via `reverseGeocodeSchema` — the same bounded lat/lng
 * range `searchDirectorySchema` already enforces) before reaching
 * `ReverseGeocodeUseCase`. A read, not a mutation — same "no Server Action
 * needed for a read" reasoning Module 19/20 gave for the `/search` page
 * itself would apply here too, except this one *is* invoked from a client
 * component (the map), which is exactly what a Server Action is for.
 *
 * No authorization/ownership check, matching `ReverseGeocodeUseCase`'s own
 * reasoning: "what address is at this point" is not account-scoped data.
 */
export async function reverseGeocodeAction(input: {
  latitude: number;
  longitude: number;
}): Promise<ReverseGeocodeActionResult> {
  const parsed = reverseGeocodeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "That location looks invalid." };
  }

  try {
    const result = await makeReverseGeocodeUseCase().execute(parsed.data);
    if (!result) {
      return { success: true, address: null, latitude: parsed.data.latitude, longitude: parsed.data.longitude };
    }

    const label = [result.address.line1, result.address.city, result.address.province]
      .filter(Boolean)
      .join(", ");

    return { success: true, address: label || result.address.city, latitude: result.point.latitude, longitude: result.point.longitude };
  } catch (error) {
    logger.error("reverse_geocode_action_failed", { error });
    return { success: false, error: "Couldn't resolve an address for that location." };
  }
}
