import { z } from "zod";

/**
 * Maps & Geolocation module (Module 20).
 *
 * DTO for resolving an approximate coordinate from a city name — used by
 * `GeocodeCityUseCase`. Same validation-limits reasoning as
 * `searchDirectorySchema` (city/province length caps to prevent pathological
 * input); no coordinates are accepted here since the whole point of this
 * schema is to *produce* one.
 */
export const geocodeCitySchema = z.object({
  city: z.string().trim().min(1, "City is required.").max(100, "City must be 100 characters or fewer."),
  province: z
    .string()
    .trim()
    .max(100, "Province must be 100 characters or fewer.")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export type GeocodeCityInput = z.infer<typeof geocodeCitySchema>;

/**
 * Module 42 — Geocoding & Maps.
 *
 * DTO for resolving the address at a given coordinate — used by
 * `ReverseGeocodeUseCase`. Same bounded-range validation
 * `searchDirectorySchema`'s `latitude`/`longitude` fields already use
 * (Module 20), so a malformed or out-of-range coordinate is rejected before
 * it ever reaches a `GeocodingProvider`.
 */
export const reverseGeocodeSchema = z.object({
  latitude: z.coerce
    .number({ invalid_type_error: "Enter a valid latitude." })
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
  longitude: z.coerce
    .number({ invalid_type_error: "Enter a valid longitude." })
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),
});

export type ReverseGeocodeInput = z.infer<typeof reverseGeocodeSchema>;
