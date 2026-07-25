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
