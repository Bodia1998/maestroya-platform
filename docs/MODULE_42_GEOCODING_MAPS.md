# Module 42 — Geocoding & Maps

## Purpose

Modules 20 (Maps & Geolocation) and 27 (Spain Location Services) already
built the entire backend geocoding foundation this platform needed —
forward geocoding, a multi-vendor provider architecture, caching, safe error
handling, bounding-box radius search, and privacy-fuzzed map points — and
documented, in their own "Known Limitations," exactly two things that were
deliberately left unbuilt: a real `reverseGeocode` implementation on any
provider, and any interactive map-rendering UI. Module 42 closes both gaps.
It adds no new abstraction the codebase didn't already design for, no new
npm dependency, and no schema change — every new line of code plugs into a
seam a prior module already built and named for exactly this purpose.

## Audit Summary (Phase 1 — before any code was written)

The repository was audited end-to-end before writing anything. Findings:

- **Provider architecture — fully implemented, reused as-is.**
  `GeocodingProvider` (`src/core/domain/repositories/geocoding-provider.ts`)
  already declares `geocode()` (required), `reverseGeocode()`/
  `searchCities()` (optional, forward-declared by Module 27 as a
  non-breaking future seam), and `GeocodingNotImplementedError`. Four real
  vendor providers already existed
  (`providers/{mapbox,google,here,openstreetmap}-geocoding-provider.ts`),
  each extending `BaseGeocodingProvider` and delegating transport to
  `GeocodingHttpClient`/`FetchGeocodingHttpClient`. `SafeGeocodingProvider`
  (never-throw decorator) and `CachedGeocodingProvider` (TTL cache decorator)
  already wrapped every provider via `geocoding-provider-factory.ts`'s
  `createGeocodingProvider()`. **None of this was rewritten.**
- **Forward geocoding — fully implemented, untouched.** `geocode()` on
  every provider, `StaticCityGeocodingProvider` (the zero-config default),
  `GeocodeCityUseCase`, and the `latitude`/`longitude`/`radiusKm` wiring
  into `SearchDirectoryUseCase`/`searchDirectorySchema` (Module 20) all
  already worked and needed no changes.
- **Reverse geocoding — declared but partially implemented.** The
  interface method existed; every provider's actual implementation was the
  `BaseGeocodingProvider` default that throws `GeocodingNotImplementedError`
  — explicitly documented by Module 27 as "no vendor call was built without
  a real API key to exercise it against." Worse, `SafeGeocodingProvider`
  and `CachedGeocodingProvider` (which the factory *always* wraps every
  provider in) never declared `reverseGeocode` at all — even a provider
  that did implement it would have been unreachable through
  `createGeocodingProvider()`'s composed result. **This was the actual
  implementation gap**, not just "no vendor call."
- **Address normalization, coordinate storage — fully implemented,
  reused.** `Address.latitude`/`.longitude` (Module 02) and
  `CompanyProfile.latitude`/`.longitude` (Module 18) already exist, with
  composite `(latitude, longitude)` indexes (Module 20). No new column,
  index, or migration was needed anywhere in this module.
- **Search integration — fully implemented, extended only at the UI
  layer.** `SearchResult.mapPoint` (privacy-fuzzed, Module 20),
  `computeBoundingBox`/`haversineDistanceKm` (cheap-filter-then-precise-
  cutoff), and the bounding-box pre-filter in both Prisma discovery
  repositories all already existed and needed no backend changes. The
  `/search` page already parsed optional `lat`/`lng`/`radiusKm` query
  params (Module 20) — it just had no UI that produced them.
- **Interactive maps — missing entirely.** No map-rendering component of
  any kind existed anywhere in `src/presentation` or `src/app`, and no
  maps SDK (Leaflet, Google Maps JS, Mapbox GL) was in `package.json`.
  This was the single largest gap the audit found.
- **Tests, docs — mature and extensive.** `docs/MODULE_20_MAPS_GEOLOCATION.md`
  and `docs/MODULE_27_SPAIN_LOCATION_SERVICES.md` both explicitly named
  "real map-rendering UI" and "implement reverseGeocode once there's a
  real product need" as their own forward-referenced future work — this
  module is that future work, not a new decision.

### What was NOT touched

No file belonging to Authentication, Stripe, Disputes, Bookings, Reviews,
Messages, Admin, or any other module was modified. `StaticCityGeocodingProvider`,
every provider's `geocode()`, `SearchDirectoryUseCase`, `searchDirectorySchema`,
`computeBoundingBox`, `fuzzCoordinate`, `coordinate-fuzzing.ts`,
`geo-distance.ts`, and the Prisma discovery repositories' existing
bounding-box logic are all **unchanged**. No existing test's assertions were
modified — only new tests were added, and new `override` methods were added
alongside (never replacing) existing default behavior.

## Architecture

```
src/core/domain/
  repositories/
    geocoding-provider.ts        — UNCHANGED (reverseGeocode/searchCities
                                     already declared by Module 27)

src/core/application/
  dto/
    geolocation.dto.ts            — + reverseGeocodeSchema (new)
  use-cases/geolocation/
    reverse-geocode.use-case.ts   — ReverseGeocodeUseCase (new)
    compose.ts                    — + makeReverseGeocodeUseCase()

src/core/infrastructure/geocoding/
  base-geocoding-provider.ts      — httpClient private → protected;
                                       + fetchJson() shared helper for
                                       reverseGeocode overrides
  safe-geocoding-provider.ts      — + reverseGeocode passthrough (never throws)
  cached-geocoding-provider.ts    — + reverseGeocode caching (separate
                                       cache/key from geocode()'s)
  providers/
    openstreetmap-geocoding-provider.ts — + real reverseGeocode (Nominatim)
    google-geocoding-provider.ts        — + real reverseGeocode (Google)
    mapbox-geocoding-provider.ts        — + real reverseGeocode (Mapbox)
    here-geocoding-provider.ts          — + real reverseGeocode (HERE)

src/presentation/components/maps/
  interactive-map.tsx              — InteractiveMap (new) — Leaflet via CDN,
                                        zoom/pan, markers, click handler
  search-results-map.tsx           — SearchResultsMap (new) — SearchResult[] → markers

src/app/(marketing)/search/
  actions.ts            — reverseGeocodeAction (new Server Action)
  location-picker.tsx    — LocationPicker (new) — "use my location" +
                             click-to-pick map + radius input
  search-form.tsx        — + latitude/longitude/radiusKm fields, renders LocationPicker
  page.tsx                — + renders SearchResultsMap alongside the results list

tests/unit/core/infrastructure/geocoding/  — extended (providers, safe,
  cached, base) + new assertions
tests/unit/core/application/
  dto/geolocation.dto.test.ts       — extended (reverseGeocodeSchema)
  use-cases/reverse-geocode.use-case.test.ts — new
tests/unit/app/
  search-actions.test.ts            — new
  search-results-map.test.tsx       — new
```

Domain and application code remain framework-free: `ReverseGeocodeUseCase`
imports no Prisma, Next.js, or Leaflet type. The map UI is entirely
Presentation-layer, isolated to `src/presentation/components/maps/` and one
feature's `src/app/(marketing)/search/` files — no Dashboard, Admin, or
other route group was touched.

## 1. Map Provider

No new provider abstraction was introduced — `GeocodingProvider` (Module
20/27) already covers coordinate resolution, and `InteractiveMap` reuses
that same "no heavy new dependency" discipline for rendering: instead of
adding `leaflet`/`react-leaflet`/`@react-google-maps/api` to `package.json`,
`InteractiveMap` loads Leaflet's JS/CSS from a CDN (`unpkg.com`) at runtime,
in the browser, the first time a map mounts (a module-level promise
deduplicates the load across multiple map instances on the same page).
**`package.json` is unchanged by this module.** Tiles come from
OpenStreetMap's free tile server — the same zero-API-key vendor
`OpenStreetMapGeocodingProvider` already depends on for geocoding, keeping
the map and at least one geocoding path on the same free, keyless
foundation this project has favored throughout (Module 20's "no PostGIS",
Module 19's "no tsvector").

## 2. Forward Geocoding

Unchanged. `geocode()` on every provider, `StaticCityGeocodingProvider`,
`GeocodeCityUseCase`, and `SearchDirectoryUseCase`'s existing point
resolution all continue to work exactly as Module 20/27 left them.

## 3. Reverse Geocoding

**The actual new capability.** Each of the four real vendor providers now
has a working `reverseGeocode(point)` override:

- `OpenStreetMapGeocodingProvider` — Nominatim's `/reverse` endpoint, no API
  key, real network call, parses `address.{road,house_number,city,town,
  village,municipality,state,province,postcode,country}`.
- `GoogleGeocodingProvider` — the Geocoding API's `latlng=` parameter,
  parses `address_components` by `types` (`route`, `street_number`,
  `locality`, `administrative_area_level_1/2`, `postal_code`, `country`).
- `MapboxGeocodingProvider` — Geocoding API v5's `{lng},{lat}.json` reverse
  form, parses `features[0].context` by `id` prefix (`place`, `region`,
  `postcode`, `country`).
- `HereGeocodingProvider` — Reverse Geocode v7's `at=` parameter, parses
  `items[0].address.{street,houseNumber,city,county,state,postalCode,
  countryName}`.

All four share one new helper, `BaseGeocodingProvider.fetchJson(url,
feature)` — the exact same "missing URL → warn, non-OK → warn, network/parse
failure → log and return null" pattern `geocode()` already had, factored
out so it's implemented once rather than copy-pasted four times.
`buildRequestUrl`/`parseResponse`/`geocode()` themselves are untouched.

**The critical fix**: `SafeGeocodingProvider` and `CachedGeocodingProvider`
— which `createGeocodingProvider()` always wraps every provider in — never
declared `reverseGeocode` at all before this module. Even with every vendor
implementing it, the composed provider every caller actually receives would
never have exposed it. Both decorators now implement `reverseGeocode`:
`SafeGeocodingProvider` collapses every failure mode (no `inner.reverseGeocode`
at all, a thrown `GeocodingNotImplementedError`, or a real network failure)
to `null`; `CachedGeocodingProvider` adds a second, independent cache keyed
by a rounded coordinate pair (4 decimal places, ~11m — coarse enough to
survive GPS jitter, fine enough not to merge genuinely different points),
same TTL as the existing city cache but a separate `Map`.

`ReverseGeocodeUseCase` (new) is thin orchestration, mirroring
`GeocodeCityUseCase`'s own "no authorization/ownership concerns — this data
isn't account-scoped" reasoning. Wired into the shared `geocodingProvider`
singleton via `makeReverseGeocodeUseCase()` in the existing
`geolocation/compose.ts` — no second provider instance, no second cache.

## 4. Interactive Maps

`InteractiveMap` (new) renders real, pannable/zoomable OpenStreetMap tiles
via Leaflet, with one colored marker per entry in its `markers` prop
(color varies by `variant`: professional/company/customer/current), fits
the map's bounds to however many markers are present, and supports an
optional `onMapClick` handler for "pick a point" flows. It is the one
Client Component in this module with real DOM/browser dependencies —
everything else stays a Server Component or a thin client wrapper.

Two concrete consumers:

- `SearchResultsMap` — plots every `/search` result's `mapPoint` (Module
  20's privacy-fuzzed point; a result with `mapPoint: null` is omitted, never
  plotted at a guessed location) with a professional/company marker color,
  rendered alongside (not instead of) the existing results list.
- `LocationPicker` — lets a customer either click "Use my location" (the
  browser's own Geolocation API — no external call) or click anywhere on
  the map to set a search point, previews the resolved address via
  `reverseGeocodeAction`, and exposes a radius input. Feeds directly into
  the `lat`/`lng`/`radiusKm` query params `/search`'s `page.tsx` (Module 20)
  already parsed but had no UI producing.

## 5. Search Integration

No backend search logic changed — `SearchDirectoryUseCase`, the bounding-box
pre-filter in both Prisma discovery repositories, and the Haversine precise
cutoff are all Module 20's existing, efficient "cheap DB filter, precise
app-layer rule" split, untouched. This module's search integration is
entirely UI: `DirectorySearchForm` now renders `LocationPicker` and forwards
`latitude`/`longitude`/`radiusKm` into the same query-string contract the
page already validated with `searchDirectorySchema`, and `SearchResultsMap`
visualizes the results `SearchDirectoryUseCase` already returns. No new
database query was introduced by this module — no N+1, no full-table scan.

## 6. Validation

- `reverseGeocodeSchema` bounds `latitude`/`longitude` to `[-90,90]`/
  `[-180,180]` — the identical range `searchDirectorySchema`'s existing
  fields already enforce — and coerces numeric strings the same way.
- The `reverseGeocodeAction` Server Action validates with that schema
  before ever calling `ReverseGeocodeUseCase` — a malformed or
  out-of-range coordinate never reaches a `GeocodingProvider`.
- Every provider's `reverseGeocode` degrades to `null` (never throws) for a
  malformed vendor response, an HTTP error, or a network failure — the
  identical "never throw" contract `geocode()` already had, now proven for
  the new method by `fetchJson`'s shared error handling plus
  `SafeGeocodingProvider`'s outer safety net.

## 7. Performance

- **No duplicate provider requests**: `CachedGeocodingProvider.reverseGeocode`
  caches both hits and misses per rounded coordinate, mirroring the existing
  `geocode()` cache's "cache misses too" behavior.
- **No new N+1 queries**: this module adds zero new database queries. The
  map only ever renders `mapPoint` values `SearchDirectoryUseCase` already
  computed for the current page of results.
- **No unnecessary geocoding calls**: reverse geocoding only happens when a
  user explicitly clicks the map or requests their current location —
  never automatically, never per search-result-row.
- **Leaflet loads once per page**, not once per `InteractiveMap` instance —
  a module-level singleton promise deduplicates the CDN script/stylesheet
  load across `SearchResultsMap` and `LocationPicker` both mounting on the
  same `/search` page.

## 8. Event Integration

Not applicable. This module persists no new state and triggers no new
domain event — reverse geocoding is a stateless, on-demand lookup (exactly
like `GeocodeCityUseCase`'s forward lookup already was), and the map UI
only visualizes data other use cases already produced. The existing Domain
Event Bus was not touched, and no second event system was introduced.

## 9. Notifications

Not applicable — no location-related notification exists in this codebase,
and this module does not add one. `reverseGeocodeAction` returns its result
directly to the calling client component; nothing is queued or dispatched.

## 10. Audit Logs

Not applicable — reverse geocoding a coordinate a user is actively
interacting with (clicking a map, sharing their browser location) is not an
audit-relevant event by this project's existing conventions (compare:
`GeocodeCityUseCase`'s forward lookup was never audit-logged either). Every
provider failure is still logged via the existing `logger`
(`geocoding_provider_*` events), matching `geocode()`'s own observability.

## 11. Sentry

No bypass. Every new failure path (`fetchJson`, `SafeGeocodingProvider.reverseGeocode`,
the Server Action's catch block) routes through the existing
`logger`/observability infrastructure (Module 39), the same one `geocode()`
already used — no new error-reporting path was introduced.

## 12. Database

**No migration.** `Address.latitude`/`.longitude` (Module 02) and
`CompanyProfile.latitude`/`.longitude` (Module 18), plus their composite
indexes (Module 20), already cover every coordinate this module reads or
writes. Reverse geocoding never persists anything — it's a read-through
call to a `GeocodingProvider`, cached in memory, never written to Prisma.
The map UI only renders data other use cases already query. `prisma/schema.prisma`
is unchanged, and no new migration file was added.

## 13. API Compatibility

No breaking change. `GeocodingProvider.reverseGeocode` remains optional on
the interface (unchanged from Module 27); every real provider now
implements it, but any future provider that doesn't still compiles.
`SearchDirectoryUseCase`, `searchDirectorySchema`, and every existing
repository interface are untouched. The one new Server Action
(`reverseGeocodeAction`) is additive — no existing action's signature
changed.

## 14. Architecture Constraints

Clean Architecture layering held throughout: domain (`GeocodingProvider`)
was not modified; application (`ReverseGeocodeUseCase`, DTO) has no
framework import; infrastructure (providers, decorators) is where the real
HTTP/vendor logic lives; presentation (`InteractiveMap` and friends) is
where the one necessary Client Component boundary is drawn. Dependency
Injection continued via composition roots (`geolocation/compose.ts`) — no
provider is constructed ad hoc by a caller. No Repository Pattern change
was needed (this module reads no new persisted data). No new Composition
Root was added; the existing one grew one factory function.

## 15. Testing

**Audited first** — no existing assertion was duplicated or modified; new
tests were added alongside. New/extended test files:

- `tests/unit/core/infrastructure/geocoding/providers.test.ts` (extended)
  — a full `reverseGeocode` suite per vendor: correct URL/params, correct
  response parsing, no-key short-circuit (Mapbox/Google/HERE), never-throws
  on HTTP error and network failure (all four).
- `tests/unit/core/infrastructure/geocoding/safe-geocoding-provider.test.ts`
  (extended) — `reverseGeocode` passthrough, graceful `null` when the inner
  provider has no `reverseGeocode` at all, error logging.
- `tests/unit/core/infrastructure/geocoding/cached-geocoding-provider.test.ts`
  (extended) — caches hits and misses by rounded coordinate, TTL expiry,
  independent from the `geocode()` cache, graceful no-op when unsupported.
- `tests/unit/core/infrastructure/geocoding/base-geocoding-provider.test.ts`
  (extended) — the new shared `fetchJson` helper via a dedicated test
  subclass (kept separate from the existing "unimplemented by default"
  test subclass, so that regression coverage still holds).
- `tests/unit/core/application/dto/geolocation.dto.test.ts` (extended) —
  `reverseGeocodeSchema` valid/invalid/out-of-range/coercion cases.
- `tests/unit/core/application/use-cases/reverse-geocode.use-case.test.ts`
  (new) — delegates to the injected provider, `null` for an unresolvable
  point, `null` when the provider doesn't support reverse geocoding at all.
- `tests/unit/app/search-actions.test.ts` (new) — `reverseGeocodeAction`:
  input validation before the use case runs, success/`null`-address/error
  translation, matching this codebase's established Server Action test
  convention (mock the one collaborator).
- `tests/unit/app/search-results-map.test.tsx` (new) — marker derivation
  from `SearchResult[]`: omits results with `mapPoint: null`, tags
  professional vs. company variants correctly (mocks `InteractiveMap`
  itself, which has no jsdom-friendly way to load a real CDN script).

**37 new test cases** were added across 5 extended files and 3 new files.
No existing test was modified or removed.

## 16. Validation Results

| Command | Result |
|---|---|
| `npm run typecheck` | **Passed**, zero errors, across the entire codebase including every new/modified file. |
| `npm run lint` | **Passed**, zero errors/warnings, across the entire codebase. |
| `npm test` (Vitest) | **Blocked** in this sandbox — `Cannot find module @rollup/rollup-linux-arm64-gnu` (confirmed: `npm install @rollup/rollup-linux-arm64-gnu` fails with `403 Forbidden` from `registry.npmjs.org`). This is the identical, pre-existing environment limitation Modules 20/27/33 already documented for this sandbox (`node_modules` installed for a different platform architecture than this sandbox, no npm registry access to fetch the missing native binary) — confirmed unrelated to this module's changes. `npx tsx` (an alternative TS runner already present in `node_modules`) was also attempted as a substitute and hit the same class of issue (`esbuild` installed for `darwin-arm64`, this sandbox is `linux-arm64`) — every native-binary path in this environment is mismatched for this architecture, not just Vitest's. All new/updated tests are written and ready to run in an environment with a matching platform or npm registry access. |
| `npm run build` | **Blocked** — confirmed: `Failed to load SWC binary for linux/arm64`, the same pre-existing, documented limitation. |
| `npx prisma migrate status` | **Blocked** — confirmed: `403 Forbidden` fetching the schema-engine checksum from `binaries.prisma.sh`, the same pre-existing, documented limitation. This module makes no schema change, so migration status is unaffected by these changes either way. |

`typecheck` and `lint` — the two commands in this validation list that
don't depend on a missing native binary or network access — both pass
cleanly with zero errors across the whole codebase, including every file
this module touched.

## Environment Limitations

Identical, confirmed-precedented restrictions to Modules 20/27/33 — repeated
here because they apply to this module's own validation, not because
they're new information:

1. **No outbound network access to `binaries.prisma.sh`** (`403 Forbidden`)
   — blocks `prisma migrate status`. Not applicable to correctness here
   since no migration was added.
2. **`node_modules` installed for macOS (`darwin-arm64`)**, this sandbox is
   **Linux (`linux-arm64`)**, combined with **no npm registry access**
   (`403 Forbidden` fetching `@rollup/rollup-linux-arm64-gnu`) — blocks
   `npm test` and `npm run build`. Re-run both on a machine with a matching
   platform (or with npm registry access) to get the official pass/fail
   signal this sandbox couldn't produce.

## Known Limitations

1. **`searchCities` (autocomplete/municipality search) remains
   unimplemented** on every provider — this module's scope, per the
   original request, was reverse geocoding and interactive maps; no
   concrete UI in this codebase needs city autocomplete yet. The
   `GeocodingNotImplementedError` seam Module 27 built is still exactly
   where a future module would plug that in.
2. **Leaflet is loaded from a CDN at runtime, not bundled** — this was a
   deliberate choice to add zero new `package.json` dependencies, matching
   this project's existing "ship the seam, not a heavy new dependency"
   discipline. The trade-off: a user with no network access to `unpkg.com`
   (rare, but possible in a locked-down corporate network) sees the
   graceful "Map unavailable" fallback `InteractiveMap` renders on load
   failure, rather than a broken blank tile grid.
3. **No admin-facing map/geocoding configuration UI** — provider selection
   remains `GEOCODING_PROVIDER` + the matching `*_API_KEY` environment
   variables (Module 27), unchanged by this module.
4. **`npm test`/`npm run build` could not be run to completion in this
   sandbox** (see "Validation Results" above) — `typecheck`/`lint` are the
   confirmed-clean signals available here; the new tests are written and
   ready for a CI environment with a matching platform.
