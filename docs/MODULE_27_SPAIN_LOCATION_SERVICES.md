# Module 27 — Spain Location Services (Production Foundation)

> **Hardening pass.** This document covers both the original Module 27
> implementation and a subsequent hardening pass applied before commit:
> `GEOCODING_PROVIDER` now defaults to (and safely falls back to)
> `STATIC` explicitly; cache keys are fully normalized (accents,
> duplicate whitespace); the `GeocodingProvider` interface gained a
> non-breaking `reverseGeocode`/`searchCities` seam; the HTTP transport
> was split out from provider business logic
> (`BaseGeocodingProvider`/`GeocodingHttpClient`); and a real end-to-end
> regression test now covers geocoding → professional discovery. See
> "Hardening Pass" below for the full detail on each item.

## Purpose

Module 20 (Maps & Geolocation) shipped a `GeocodingProvider` abstraction
and a small, ~30-city `StaticCityGeocodingProvider` as a deliberately
temporary default, and documented — in its own "Known Limitations #1" — a
real vendor provider as the expected future integration point. Module 27
is that documented next step: it does **not** replace
`StaticCityGeocodingProvider` (it remains the zero-config default and the
fallback whenever a real provider isn't configured), but it builds the
rest of the production foundation around it — a provider factory, four
ready-to-enable vendor implementations, environment configuration, a
cache, and a hardened error boundary — so a real Geocoding API can be
turned on later purely by setting two environment variables.

**Users never enter latitude/longitude.** That was already true before
this module (see `ProfessionalOnboardingInput`/service-request DTOs — no
coordinate field exists on any user-facing input) and remains true here;
coordinates are resolved entirely server-side by whichever
`GeocodingProvider` is configured, and stay internal (`Address.latitude`/
`.longitude`, `CompanyProfile.latitude`/`.longitude` — never returned to a
client except as `SearchResult.mapPoint`, which Module 20 already fuzzes
for privacy).

**No real API key exists yet, and none is hardcoded or required.** Every
new environment variable this module adds is optional; the app boots and
every existing flow (onboarding, Service Request creation, search) behaves
identically whether or not any of them are set.

## Architecture

```
src/core/domain/
  repositories/
    geocoding-provider.ts   — GeocodingProvider.geocode() UNCHANGED
                               + new optional reverseGeocode()/searchCities()
                               declared directly on GeocodingProvider (not a
                               separate "Extended" interface) — non-breaking,
                               see "Future-Capability Interface" below
                               + GeocodingNotImplementedError

src/core/infrastructure/
  config/
    env.ts                        — + GEOCODING_PROVIDER (defaults to and
                                       safely falls back to STATIC),
                                       MAPBOX_API_KEY, GOOGLE_GEOCODING_API_KEY,
                                       HERE_API_KEY (all optional)
  geocoding/
    static-city-geocoding-provider.ts   — UNCHANGED behavior (still the
                                            default); now reuses the shared
                                            normalizeLocationText() helper
                                            instead of a local copy
    normalize-location-text.ts          — new shared trim/collapse-space/
                                            lowercase/strip-accent helper,
                                            used by both the static table
                                            lookup and the cache key
    geocoding-http-client.ts            — new: GeocodingHttpClient interface
                                            + FetchGeocodingHttpClient (the
                                            transport layer, decoupled from
                                            provider logic)
    base-geocoding-provider.ts          — new: BaseGeocodingProvider — the
                                            provider/business-logic base
                                            class every real vendor provider
                                            extends; delegates the actual
                                            network call to an injected
                                            GeocodingHttpClient; provides the
                                            default "not implemented" seam
                                            for reverseGeocode/searchCities
    http-geocoding-provider.ts          — deprecated thin re-export of
                                            BaseGeocodingProvider (kept for
                                            any lingering reference by name;
                                            not used by any provider anymore)
    safe-geocoding-provider.ts          — decorator: catches anything a
                                            wrapped provider throws, logs it,
                                            returns null
    cached-geocoding-provider.ts        — decorator: simple in-memory TTL
                                            cache in front of any provider;
                                            cache keys go through
                                            normalizeLocationText()
    geocoding-provider-factory.ts       — createGeocodingProvider(): reads
                                            GEOCODING_PROVIDER, builds the
                                            selected provider (STATIC is an
                                            explicit case, not just the
                                            absence of one; anything else
                                            invalid also lands on Static),
                                            wraps it in Safe then Cached
    providers/
      mapbox-geocoding-provider.ts        — real Mapbox Geocoding API v5 client, extends BaseGeocodingProvider
      google-geocoding-provider.ts        — real Google Geocoding API client, extends BaseGeocodingProvider
      here-geocoding-provider.ts          — real HERE Geocoding & Search v7 client, extends BaseGeocodingProvider
      openstreetmap-geocoding-provider.ts — real Nominatim client (no key needed), extends BaseGeocodingProvider

src/core/application/use-cases/
  geolocation/compose.ts       — calls createGeocodingProvider() instead of
                                   `new StaticCityGeocodingProvider()`
  professional/compose.ts      — imports the shared geocodingProvider from
                                   geolocation/compose.ts instead of
                                   constructing its own instance
  service-request/compose.ts   — same as professional/compose.ts

.env.example                   — the four variables, documented; GEOCODING_PROVIDER defaults to "STATIC"

tests/
  unit/core/infrastructure/geocoding/          — factory, cache, safety, HTTP
                                                   client, base provider,
                                                   vendor providers, text
                                                   normalization
  unit/core/infrastructure/config/env.test.ts   — + GEOCODING_PROVIDER
                                                    default/fallback/validity cases
  integration/geolocation/service-request-discovery-flow.test.ts — new
    end-to-end regression test (see "End-to-End Discovery Test" below)
```

Every new/modified file lives under `src/core/infrastructure/geocoding/`
(or is a narrowly-scoped addition to `env.ts`/`geocoding-provider.ts`/the
three compose files that already depended on geocoding, or a new test
file). No file belonging to Authentication, Stripe, the Dashboard,
Messages, Disputes, Bookings, or Reviews was touched.

## Provider Architecture

```
GeocodingProvider (interface)
  geocode(query): Promise<GeoPoint | null>            — required
  reverseGeocode?(point): Promise<...>                 — optional, future
  searchCities?(query, province?): Promise<...>        — optional, future
  ↑ implements
StaticCityGeocodingProvider   (default — no HTTP client at all)
BaseGeocodingProvider (abstract) — provider/business logic only:
  request building, response parsing, error handling,
  default GeocodingNotImplementedError for reverseGeocode/searchCities
  ↓ delegates the network call to
GeocodingHttpClient (interface) — transport only
  ↑ default implementation
FetchGeocodingHttpClient — plain fetch + AbortController timeout
  ↑ BaseGeocodingProvider extended by
  MapboxGeocodingProvider
  GoogleGeocodingProvider
  HereGeocodingProvider
  OpenStreetMapGeocodingProvider  (no API key required)
```

Splitting `BaseGeocodingProvider` (business logic) from
`GeocodingHttpClient` (transport) is what makes "replace fetch with an
official vendor SDK later without rewriting any provider's business
logic" true — a future SDK-backed client would only need a new
`GeocodingHttpClient` implementation (or a provider that skips the client
and calls the SDK directly inside its own `buildRequestUrl`/
`parseResponse`), never a change to how `geocode()` builds a request,
parses a response, or catches/logs a failure — that lives once, in
`BaseGeocodingProvider`, not duplicated per vendor.

`createGeocodingProvider()` selects **exactly one** base provider from
`env.GEOCODING_PROVIDER`, then always wraps it:

```
createGeocodingProvider()
  → buildBaseProvider()            (Static | Mapbox | Google | Here | OSM)
  → new SafeGeocodingProvider(...)  — never throws/hangs a caller
  → new CachedGeocodingProvider(...) — avoids repeat outbound requests, normalized keys
```

Every caller (`GeocodeCityUseCase`, `SearchDirectoryUseCase`,
`CompleteProfessionalOnboardingUseCase`, `CreateServiceRequestUseCase`,
`UpdateServiceRequestUseCase`) still only depends on the plain
`GeocodingProvider` interface — none of them changed.

## Provider Selection & Fallback Behavior (Hardened)

**The default provider is always `STATIC`, and no real HTTP request can
ever happen by accident:**

1. `env.ts`: `GEOCODING_PROVIDER: z.enum(["STATIC", "MAPBOX", "GOOGLE", "HERE", "OSM"]).catch("STATIC")`.
   `.catch()` — not just `.default()` — means an **invalid** value (a
   typo, a value left over from another environment) also resolves to
   `STATIC` instead of throwing and failing the entire app's startup over
   a non-critical, misconfigured setting. Unset, empty, or invalid all
   land here.
2. `geocoding-provider-factory.ts`'s `buildBaseProvider()` has an explicit
   `case "STATIC"` (not just an implicit default) that returns
   `StaticCityGeocodingProvider` immediately — no HTTP client class is
   even instantiated on this path.
3. Selecting `MAPBOX`/`GOOGLE`/`HERE` without the matching `*_API_KEY` set
   logs `geocoding_provider_missing_api_key` and falls back to
   `StaticCityGeocodingProvider` — never a startup failure, never a
   doomed key-less HTTP request.
4. `OSM` needs no key and is constructed directly — the one real,
   network-backed provider reachable with zero configuration, which is
   exactly why it is never the *default*, only an explicit opt-in.
5. Any other value that somehow reaches `buildBaseProvider()` (there
   shouldn't be one, given step 1) still falls through to
   `StaticCityGeocodingProvider` via the `switch`'s own `default` case —
   defense in depth, verified directly in
   `geocoding-provider-factory.test.ts` by mocking `env` to bypass step 1
   entirely.

## Environment Variables Prepared

| Variable | Default | Purpose |
|---|---|---|
| `GEOCODING_PROVIDER` | `STATIC` (also the fallback for any unset/invalid value) | `STATIC` \| `MAPBOX` \| `GOOGLE` \| `HERE` \| `OSM` |
| `MAPBOX_API_KEY` | empty | Required only if `GEOCODING_PROVIDER=MAPBOX` |
| `GOOGLE_GEOCODING_API_KEY` | empty | Required only if `GEOCODING_PROVIDER=GOOGLE` |
| `HERE_API_KEY` | empty | Required only if `GEOCODING_PROVIDER=HERE` |

## API Integration Readiness

To connect a real provider later:

1. Get an API key from Mapbox, Google, or HERE.
2. Set `GEOCODING_PROVIDER=MAPBOX` (or `GOOGLE`/`HERE`) and the matching
   `*_API_KEY` in `.env.local`/production environment.
3. Restart the app.

No code change is required — steps 1–3 are the entire integration. Each
provider already targets the real vendor endpoint with a correct,
Spain-scoped request (`country=es` / `region=es` / `in=countryCode:ESP`)
and parses that vendor's real response shape; this was verified against
each vendor's documented response format and exercised with mocked
`fetch` responses in `tests/unit/core/infrastructure/geocoding/providers.test.ts`
and, at the transport layer, `geocoding-http-client.test.ts`.

If a vendor later ships an official SDK that should replace raw `fetch`
calls, that swap only touches `GeocodingHttpClient` (a new
implementation, e.g. an SDK-backed client) or a provider's own override —
`BaseGeocodingProvider`'s request-building/parsing/error-handling logic
never has to change (see "Provider Architecture" above).

## Future-Capability Interface (Forward/Reverse Geocoding, Autocomplete, Municipality Search)

`GeocodingProvider` (`geocoding-provider.ts`) now declares two additional,
**optional** methods directly on the primary interface itself — not a
separate "Extended" interface — so a future module depending on
`GeocodingProvider` never needs a second interface or a breaking change
when these are implemented:

```ts
interface GeocodingProvider {
  geocode(query: CityGeocodeQuery): Promise<GeoPoint | null>;           // forward geocoding — required, unchanged
  reverseGeocode?(point: GeoPoint): Promise<ReverseGeocodeResult | null>; // reverse geocoding — optional
  searchCities?(partialQuery: string, province?: string | null): Promise<CitySuggestion[]>; // autocomplete + municipality search — optional
}
```

Being optional (`?`) is what keeps this non-breaking: `StaticCityGeocodingProvider`,
every vendor provider, and every test fake across the codebase that
implements `GeocodingProvider` continues to compile and behave
identically without adding either method. `BaseGeocodingProvider` gives
every real vendor provider a concrete, working default for both —
`reverseGeocode`/`searchCities` throw a `GeocodingNotImplementedError`
(a specific, named error, never a bare `Error`) via a `notImplemented()`
helper — so a future caller can catch specifically "not built yet" and
degrade (hide an autocomplete field, skip a reverse-geocode preview)
rather than treating it like a real request failure. No provider
implements either method yet — there is no vendor call to build without a
real API key to exercise it against — but the contract, the error
semantics, and the default behavior are all in place.

`searchCities` deliberately covers both "city autocomplete" (suggest-as-
you-type) and "municipality search" as a single capability, since in
Spain's administrative model a municipality *is* the city/town unit this
app already asks users for — `CitySuggestion.isMunicipality` lets a
future implementation flag the distinction if a vendor's autocomplete
also surfaces smaller localities.

## Caching (Normalized)

`CachedGeocodingProvider` — a process-local `Map<string, {value, expiresAt}>`
keyed by normalized `city|province|country`, 24-hour TTL by default,
caches both hits and "unknown city" misses.

**Cache key normalization** (hardening item 2): keys go through
`normalizeLocationText` (`normalize-location-text.ts`) — trim, collapse
duplicate internal whitespace to a single space, lowercase, strip
accents/diacritics. `"Valencia"`, `"VALENCIA"`, `"valencia"`,
`" València "`, and `"valéncia"` all produce the exact same cache key, so
the same real-world place can never be split across multiple cache
entries just because a caller spelled, cased, or spaced it differently.
`StaticCityGeocodingProvider`'s own table lookup was updated to use the
same shared function (it previously had its own local copy of equivalent
logic), so a city name normalizes identically everywhere it is compared
in this codebase — one implementation, not two that happen to agree.

Deliberately simple otherwise, per this module's scope; a future shared
cache (Redis, keyed off the already-validated `REDIS_URL` from Module 25)
can replace it without `GeocodingProvider` callers changing at all.

## Error Handling

Two layers, both "log and continue, never throw":

1. `BaseGeocodingProvider.geocode()` — every real provider's own
   try/catch around request building, the network call (via the injected
   `GeocodingHttpClient`), and response parsing.
2. `SafeGeocodingProvider` — a second, provider-agnostic layer the
   factory wraps around *any* resolved provider (including Static),
   guaranteeing the property holds even for a future provider that
   forgets its own error handling.

A geocoding failure of any kind degrades to `null` coordinates — exactly
the same "unknown city" outcome the codebase already treats as normal —
so onboarding and Service Request creation always keep the record and
continue.

## End-to-End Discovery Test

`tests/integration/geolocation/service-request-discovery-flow.test.ts`
(new) is the one integration test in this codebase that runs the **real**
`createGeocodingProvider()` chain (not a fake) all the way through:

```
customer submits a request (city only, no lat/lng)
  → CreateServiceRequestUseCase geocodes it via createGeocodingProvider()
  → the resolved coordinate is what gets persisted on the request
  → that same persisted coordinate feeds the discovery read-model
    (mirroring the two-repositories/one-underlying-row relationship
    ServiceRequestRepository/ServiceRequestDiscoveryRepository have in
    production)
  → a professional with a matching category and a base location geocoded
    through the exact same provider instance sees the request in
    GetAvailableServiceRequestsForProfessionalUseCase's results
```

A second case in the same file proves the negative: a city the default
provider can't resolve persists with `null` coordinates and the request
never becomes discoverable — reproducing, at the real-provider level, the
exact production bug `quote-flows.test.ts`'s own regression test already
covers with a fake provider (see that test's doc comment for the original
incident). This test complements, rather than replaces, the existing
narrower tests: `service-request-flows.test.ts` exercises
`CreateServiceRequestUseCase` in isolation with a fake provider, and
`quote-flows.test.ts` exercises discovery in isolation with
directly-seeded coordinates; this new test is the only one proving the
real geocoding layer's actual output is what discovery ends up matching
against.

## Tests Updated

New/updated (`tests/unit/core/infrastructure/geocoding/`, unless noted):

- `normalize-location-text.test.ts` — the exact "Valencia" case/accent/
  whitespace variant set produces one identical key; idempotence.
- `cached-geocoding-provider.test.ts` — caches hits and misses, distinct
  keys per city/province, TTL expiry, and (new) the same accent/case/
  whitespace normalization matrix as `normalize-location-text.test.ts`,
  exercised through the cache directly.
- `safe-geocoding-provider.test.ts` — never throws, logs, passes through
  a working provider's result unchanged.
- `base-geocoding-provider.test.ts` (new) — delegates the network call to
  an injected `GeocodingHttpClient` (not global `fetch`), passes
  `requestInit()` through, returns `null` on a declined query/non-ok
  response/rejected client call, and `reverseGeocode`/`searchCities`
  throw a named `GeocodingNotImplementedError` by default.
- `geocoding-http-client.test.ts` (new) — `FetchGeocodingHttpClient`
  delegates to global `fetch` and aborts on timeout.
- `geocoding-provider-factory.test.ts` (extended) — every provider
  selection (`STATIC` explicit, unset, `MAPBOX`/`GOOGLE`/`HERE` with and
  without a key, `OSM`), zero outbound HTTP calls on the Static path, a
  real outbound request only once a valid provider + key are both set,
  and a defense-in-depth case proving `buildBaseProvider()`'s own
  fallback still works if an invalid value ever bypassed `env.ts`.
- `providers.test.ts` — Mapbox/Google/HERE/OSM: correct request URL/auth
  per vendor, correct response parsing, `null` (never a throw) on an HTTP
  error or network failure.
- `tests/unit/core/infrastructure/config/env.test.ts` (extended) —
  `GEOCODING_PROVIDER` defaults to `STATIC` when unset, falls back to
  `STATIC` for an invalid or empty value, accepts every valid value
  unchanged, and is case-sensitive.
- `tests/integration/geolocation/service-request-discovery-flow.test.ts`
  (new) — see "End-to-End Discovery Test" above.

Existing tests (`static-city-geocoding-provider.test.ts`,
`geocode-city.use-case.test.ts`, `quote-flows.test.ts`,
`service-request-flows.test.ts`, `onboarding-flows.test.ts`, and every
other professional-onboarding/service-request/search unit and integration
test) were not modified — none of their assertions or constructor
signatures changed. This was possible specifically because
`reverseGeocode`/`searchCities` were added as **optional** interface
members (see "Future-Capability Interface" above) — every existing
`GeocodingProvider` fake across these test files continues to compile
without adding either method.

## Validation Results

| Command | Result |
|---|---|
| `npm run typecheck` | **Passed**, zero errors, across the whole codebase including every new/modified file from both the original module and this hardening pass. |
| `npm run lint` | **Passed**, zero errors/warnings, on every new/modified file. |
| `npm test` | **Blocked** in this sandbox — `Cannot find module @rollup/rollup-linux-arm64-gnu` (Vitest/Rollup's native binary is missing for this environment's architecture) and the npm registry returns `403 Forbidden`, so it can't be fetched. Same pre-existing, environment-specific limitation Module 20/25 already documented for this sandbox — confirmed unrelated to these changes. All new/updated tests are written and ready to run in an environment with a matching platform or npm registry access. |
| `npm run build` | **Blocked** — confirmed: `Failed to load SWC binary for linux/arm64` (same native-binary restriction as `npm test`). |
| `npx prisma validate` | **Blocked** — confirmed: `403 Forbidden` fetching the schema-engine binary/checksum from `binaries.prisma.sh`, including with `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` set. |
| `npx prisma migrate status` | **Blocked** — same `binaries.prisma.sh` `403 Forbidden`. |

Module 27 (both the original pass and this hardening pass) makes **no
Prisma schema changes** — no new tables/columns, no migration — so
`prisma validate`/`migrate status` are unaffected by these changes either
way; their blocked status here is purely this sandbox's own network
restriction, present before this module existed.

## Remaining Work Before Connecting a Real API

1. **Obtain a real API key** from Mapbox, Google, or HERE (business
   decision — cost, rate limits, coverage — out of scope for this
   module).
2. **Set `GEOCODING_PROVIDER` + the matching `*_API_KEY`** in the target
   environment.
3. **Run `npm test`/`npm run build` on a machine with a matching platform
   or npm registry access** to get the official pass/fail signal this
   sandbox couldn't produce (see "Validation Results").
4. **Smoke-test the live vendor call** against a handful of real Spanish
   municipalities once a key exists — the request/response shapes here
   were verified against each vendor's documented contract, not a live
   call (no key exists to make one with yet).
5. **Consider a shared cache** (Redis, via the already-validated
   `REDIS_URL`) if the app ever runs multiple instances — today's
   `CachedGeocodingProvider` is process-local, so each instance warms its
   cache independently (never incorrect, just less efficient across a
   multi-instance deployment).
6. **Implement `reverseGeocode`/`searchCities`** on whichever provider is
   chosen, once there's a real product need for them — the contract, the
   `GeocodingNotImplementedError` fallback, and `BaseGeocodingProvider`'s
   shared error-handling are all ready; no implementation was forced in
   without a concrete caller.
7. **Consider an SDK-backed `GeocodingHttpClient`** if the chosen vendor's
   official SDK offers meaningfully better reliability/retry behavior
   than plain `fetch` — the transport/business-logic split added in this
   hardening pass makes that a contained change (see "Provider
   Architecture").
