"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Module 42 — Geocoding & Maps.
 *
 * The interactive map UI Module 20 deliberately did not build (see
 * docs/MODULE_20_MAPS_GEOLOCATION.md, "Known Limitations #2" — "no
 * Leaflet/Google Maps/Mapbox JS widget was added ... no such dependency
 * exists in package.json"). This component still adds **no new npm
 * dependency** — `package.json` is unchanged by this module — by loading
 * Leaflet's JS/CSS from a CDN (`unpkg.com`) at runtime, in the browser,
 * exactly the same "external script" pattern this codebase already uses
 * for other browser-only, non-bundled concerns. This keeps the same
 * "ship a real capability without a heavy new build-time dependency"
 * discipline every prior module in this project followed (Module 20's own
 * "no PostGIS", Module 19's "no tsvector").
 *
 * Renders real interactive tiles (OpenStreetMap — the same free, no-API-key
 * tile source this project's own `OpenStreetMapGeocodingProvider` already
 * depends on for geocoding), with pan/zoom, one marker per `markers` entry,
 * and an optional click handler for "pick a point" flows. Client Component
 * because Leaflet is a DOM-manipulating library with no server-rendering
 * story — the same reasoning every other interactive widget in
 * `presentation/components` already follows.
 */
export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label?: string;
  /** Controls marker color — a purely visual distinction, never a source of truth. */
  variant?: "professional" | "company" | "customer" | "current";
}

export interface InteractiveMapProps {
  markers: MapMarker[];
  /** Used when there are no markers to fit bounds to. Defaults to Spain's centroid. */
  fallbackCenter?: { latitude: number; longitude: number };
  zoom?: number;
  heightClassName?: string;
  onMapClick?: (point: { latitude: number; longitude: number }) => void;
  className?: string;
}

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const SPAIN_CENTROID = { latitude: 40.4168, longitude: -3.7038 };

const MARKER_COLORS: Record<NonNullable<MapMarker["variant"]>, string> = {
  professional: "#2563eb",
  company: "#7c3aed",
  customer: "#059669",
  current: "#dc2626",
};

// Module-level singleton promise so multiple `InteractiveMap` instances on
// the same page (e.g. a results map and a location-picker map) only ever
// load the Leaflet script/stylesheet once, never once per component
// instance — avoids duplicate `<script>`/`<link>` tags and redundant
// network requests.
let leafletLoadPromise: Promise<LeafletNamespace> | null = null;

// Minimal structural type for the pieces of the Leaflet global this
// component actually uses — avoids depending on `@types/leaflet` (not a
// dependency) while keeping the rest of this file type-checked.
interface LeafletNamespace {
  map(element: HTMLElement, options?: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, options?: Record<string, unknown>): { addTo(map: LeafletMap): unknown };
  marker(latLng: [number, number], options?: Record<string, unknown>): LeafletMarker;
  divIcon(options: Record<string, unknown>): unknown;
  latLngBounds(points: Array<[number, number]>): { pad(amount: number): unknown };
}

interface LeafletMap {
  setView(latLng: [number, number], zoom: number): LeafletMap;
  fitBounds(bounds: unknown, options?: Record<string, unknown>): LeafletMap;
  remove(): void;
  on(event: string, handler: (event: { latlng: { lat: number; lng: number } }) => void): void;
}

interface LeafletMarker {
  addTo(map: LeafletMap): LeafletMarker;
  bindPopup(content: string): LeafletMarker;
}

function loadLeaflet(): Promise<LeafletNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Leaflet can only load in a browser."));
  }

  const existing = (window as unknown as { L?: LeafletNamespace }).L;
  if (existing) return Promise.resolve(existing);

  if (!leafletLoadPromise) {
    leafletLoadPromise = new Promise<LeafletNamespace>((resolve, reject) => {
      if (!document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = LEAFLET_CSS_URL;
        document.head.appendChild(link);
      }

      const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_JS_URL}"]`);
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve((window as unknown as { L: LeafletNamespace }).L));
        existingScript.addEventListener("error", () => reject(new Error("Failed to load Leaflet.")));
        return;
      }

      const script = document.createElement("script");
      script.src = LEAFLET_JS_URL;
      script.async = true;
      script.addEventListener("load", () => resolve((window as unknown as { L: LeafletNamespace }).L));
      script.addEventListener("error", () => reject(new Error("Failed to load Leaflet.")));
      document.head.appendChild(script);
    });
  }

  return leafletLoadPromise;
}

export function InteractiveMap({
  markers,
  fallbackCenter = SPAIN_CENTROID,
  zoom = 12,
  heightClassName = "h-80",
  onMapClick,
  className,
}: InteractiveMapProps) {
  const containerId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;

        const map = L.map(containerRef.current);
        mapRef.current = map;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        if (onMapClick) {
          map.on("click", (event) => onMapClick({ latitude: event.latlng.lat, longitude: event.latlng.lng }));
        }

        if (markers.length > 0) {
          const points: Array<[number, number]> = markers.map((marker) => [marker.latitude, marker.longitude]);
          for (const marker of markers) {
            const color = MARKER_COLORS[marker.variant ?? "customer"];
            const icon = L.divIcon({
              className: "",
              html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,0.4);"></span>`,
              iconSize: [14, 14],
            });
            const leafletMarker = L.marker([marker.latitude, marker.longitude], { icon }).addTo(map);
            if (marker.label) leafletMarker.bindPopup(marker.label);
          }

          if (points.length === 1) {
            map.setView(points[0]!, zoom);
          } else {
            map.fitBounds(L.latLngBounds(points).pad(0.2));
          }
        } else {
          map.setView([fallbackCenter.latitude, fallbackCenter.longitude], zoom);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Couldn't load the map.");
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Markers/center intentionally re-run the whole effect — Leaflet's own
    // imperative API has no cheap "diff the markers" story, and map
    // instances here are small (a handful of search results/locations),
    // so a full teardown/rebuild on change is simple and correct rather
    // than a premature optimization.
  }, [markers, fallbackCenter.latitude, fallbackCenter.longitude, zoom, onMapClick]);

  if (loadError) {
    return (
      <div className={`flex ${heightClassName} items-center justify-center rounded-md border border-border bg-foreground/5 text-sm text-foreground/60 ${className ?? ""}`}>
        Map unavailable — {loadError}
      </div>
    );
  }

  return (
    <div
      id={containerId}
      ref={containerRef}
      role="application"
      aria-label="Map"
      className={`w-full ${heightClassName} rounded-md border border-border ${className ?? ""}`}
    />
  );
}
