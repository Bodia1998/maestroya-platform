"use client";

import { useMemo } from "react";

import type { SearchResult } from "@/domain/entities/search-result";
import { InteractiveMap, type MapMarker } from "@/components/maps/interactive-map";

/**
 * Module 42 — Geocoding & Maps.
 *
 * Renders `SearchResult.mapPoint` (Module 20 — always the privacy-fuzzed
 * point, never a candidate's precise base coordinate; see
 * `coordinate-fuzzing.ts`) on an `InteractiveMap`. This is the map UI
 * `SearchResult.mapPoint`'s own doc comment already named as "for a future
 * map UI to place a marker at" — this module is that future.
 *
 * A result with `mapPoint: null` (no coordinates at all) is simply omitted
 * from the map — never plotted at a guessed or default location, matching
 * the same "absence of data is not zero/default" discipline
 * `SearchDirectoryUseCase`'s own radius filtering already follows.
 */
export function SearchResultsMap({ results }: { results: SearchResult[] }) {
  const markers = useMemo<MapMarker[]>(
    () =>
      results
        .filter((result): result is SearchResult & { mapPoint: NonNullable<SearchResult["mapPoint"]> } =>
          Boolean(result.mapPoint),
        )
        .map((result) => ({
          id: `${result.kind}-${result.id}`,
          latitude: result.mapPoint.latitude,
          longitude: result.mapPoint.longitude,
          label: result.displayName,
          variant: result.kind === "PROFESSIONAL" ? "professional" : "company",
        })),
    [results],
  );

  if (markers.length === 0) return null;

  return <InteractiveMap markers={markers} heightClassName="h-96" />;
}
