import type { GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import type { GeocodeCityInput } from "@/application/dto/geolocation.dto";

/**
 * Maps & Geolocation module (Module 20).
 *
 * Thin orchestration around `GeocodingProvider` — no authorization/ownership
 * concerns of its own, since resolving "roughly where is this city" is not
 * sensitive data tied to any account (contrast with a professional's own
 * precise base coordinates, which stay private — see
 * `coordinate-fuzzing.ts`). Intended for a future profile-editing UI (so a
 * professional/company can preview/confirm a coordinate for their own
 * city before it's saved to their Address/CompanyProfile — Module 20 does
 * not itself wire this into any existing profile-update flow, keeping this
 * additive and low-risk per the module's scope) and for
 * `SearchDirectoryUseCase`'s own city-to-point resolution.
 *
 * Returns `null` (never throws) when the city isn't recognized — "unknown
 * city" is an expected, ordinary outcome for a lookup-table-backed
 * provider, not an error condition.
 */
export class GeocodeCityUseCase {
  constructor(private readonly geocoding: GeocodingProvider) {}

  async execute(input: GeocodeCityInput): Promise<GeoPoint | null> {
    return this.geocoding.geocode({ city: input.city, province: input.province });
  }
}
