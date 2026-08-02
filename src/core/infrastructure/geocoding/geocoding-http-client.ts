import "server-only";

/**
 * Module 27 — Spain Location Services hardening.
 *
 * The transport seam every real `GeocodingProvider` implementation talks
 * through, instead of calling the global `fetch` directly. Separating this
 * out is what lets `BaseGeocodingProvider` (and every concrete provider
 * built on it) be swapped from a plain HTTP `fetch` call to an official
 * vendor SDK (Mapbox's `@mapbox/mapbox-sdk`, Google's
 * `@googlemaps/google-maps-services-js`, etc.) later **without touching
 * any provider's business logic** (request building, response parsing,
 * error handling) — only a new `GeocodingHttpClient` implementation (or a
 * dedicated SDK-backed provider that skips this client entirely) would be
 * needed.
 *
 * Deliberately minimal — just enough shape for "make a GET request, get a
 * status and a JSON body back" — not a general-purpose HTTP client. No
 * concrete provider needs more than this today.
 */
export interface GeocodingHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface GeocodingHttpClient {
  get(url: string, init?: RequestInit): Promise<GeocodingHttpResponse>;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * The default `GeocodingHttpClient` — plain `fetch` with a bounded
 * timeout via `AbortController`. Every real provider uses this unless a
 * different client is explicitly injected (e.g. a fake in tests, or a
 * future SDK-backed client).
 */
export class FetchGeocodingHttpClient implements GeocodingHttpClient {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  async get(url: string, init?: RequestInit): Promise<GeocodingHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}
