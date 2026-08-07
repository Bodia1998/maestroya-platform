import "@testing-library/jest-dom/vitest";

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResult } from "@/domain/entities/search-result";

/**
 * Module 42 — Geocoding & Maps.
 *
 * `SearchResultsMap` (src/presentation/components/maps/search-results-map.tsx)
 * has exactly one real responsibility of its own: turning
 * `SearchResult[]` into the `MapMarker[]` shape `InteractiveMap` renders,
 * filtering out results with no `mapPoint` (Module 20 — a candidate with
 * no coordinates at all). `InteractiveMap` itself (Leaflet-via-CDN, DOM
 * manipulation) is mocked here — it has its own, separate concerns and no
 * jsdom-friendly way to load a real CDN script in a unit test — so this
 * test asserts on the props `SearchResultsMap` passes it, not on rendered
 * map tiles.
 */
const mockInteractiveMap = vi.fn((_props: unknown) => null);
vi.mock("@/components/maps/interactive-map", () => ({
  InteractiveMap: (props: unknown) => mockInteractiveMap(props),
}));

const { SearchResultsMap } = await import("../../../src/presentation/components/maps/search-results-map");

function professionalResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: "PROFESSIONAL",
    id: "pro-1",
    displayName: "Ana Martínez",
    categoryIds: [],
    city: "Gandia",
    province: "Valencia",
    profileImageUrl: null,
    isVerified: true,
    averageRating: 4.8,
    reviewCount: 12,
    portfolioItemCount: 3,
    rankingReasons: [],
    mapPoint: { latitude: 38.9665, longitude: -0.1817 },
    businessName: null,
    headline: null,
    yearsExperience: 5,
    hourlyRate: 25,
    ...overrides,
  } as SearchResult;
}

describe("SearchResultsMap", () => {
  // `mockInteractiveMap` is one shared `vi.fn()` for the whole describe
  // block (it has to be — the `vi.mock` factory above closes over it).
  // Without clearing between tests, `mock.calls` accumulates across every
  // `it()` in this file, so `mock.calls[0]` silently reads a *previous*
  // test's call instead of the current one — which is exactly what caused
  // this suite's false failure ("tags a company result's marker with the
  // company variant" reading back "professional", the prior test's call).
  // Clearing here, not just in the affected test, is what makes every
  // test's `mock.calls[0]` reliably mean "this test's call".
  beforeEach(() => {
    mockInteractiveMap.mockClear();
  });

  it("renders nothing when no result has a mapPoint", () => {
    const { container } = render(<SearchResultsMap results={[professionalResult({ mapPoint: null })]} />);

    expect(container).toBeEmptyDOMElement();
    expect(mockInteractiveMap).not.toHaveBeenCalled();
  });

  it("passes one marker per result that has a mapPoint, omitting those that don't", () => {
    const withPoint = professionalResult({ id: "pro-1" });
    const withoutPoint = professionalResult({ id: "pro-2", mapPoint: null });

    render(<SearchResultsMap results={[withPoint, withoutPoint]} />);

    expect(mockInteractiveMap).toHaveBeenCalledTimes(1);
    const props = mockInteractiveMap.mock.calls[0]?.[0] as { markers: Array<{ id: string; variant: string }> };
    expect(props.markers).toHaveLength(1);
    expect(props.markers[0]).toMatchObject({ id: "PROFESSIONAL-pro-1", variant: "professional" });
  });

  it("tags a company result's marker with the company variant", () => {
    const company: SearchResult = {
      kind: "COMPANY",
      id: "co-1",
      displayName: "FixIt SL",
      categoryIds: [],
      city: "Valencia",
      province: "Valencia",
      profileImageUrl: null,
      isVerified: true,
      averageRating: 4.5,
      reviewCount: 30,
      portfolioItemCount: 0,
      rankingReasons: [],
      mapPoint: { latitude: 39.4699, longitude: -0.3763 },
      legalName: "FixIt Servicios SL",
      description: null,
      teamSize: 4,
    };

    render(<SearchResultsMap results={[company]} />);

    const props = mockInteractiveMap.mock.calls[0]?.[0] as { markers: Array<{ variant: string }> };
    expect(props.markers[0]?.variant).toBe("company");
  });
});
