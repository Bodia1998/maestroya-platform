"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InteractiveMap, type MapMarker } from "@/components/maps/interactive-map";
import { reverseGeocodeAction } from "./actions";

export interface LocationValue {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
}

/**
 * Module 42 — Geocoding & Maps.
 *
 * Fills the exact gap Module 20's own docs named as "not built" — a map
 * picker / "search near me" UI on the `/search` form
 * (docs/MODULE_20_MAPS_GEOLOCATION.md, "Routes / Server Actions": "no
 * search-form.tsx UI changes were made ... since that would require a
 * browser geolocation permission flow or a map-picker UI that has no
 * supporting dependency in this codebase yet"). `InteractiveMap` (this
 * module) is that dependency.
 *
 * Two ways to set a search point, both ending at the same `onChange`:
 *   1. "Use my location" — the browser Geolocation API (no external call).
 *   2. Click anywhere on the map — sets that point directly.
 * Either way, the resolved point is reverse-geocoded (via the
 * `reverseGeocodeAction` Server Action, Module 42) purely for a
 * human-readable confirmation label — the search itself always uses the
 * numeric coordinates, never the label text, matching
 * `searchDirectorySchema`'s existing lat/lng contract.
 */
export function LocationPicker({ value, onChange }: { value: LocationValue; onChange: (value: LocationValue) => void }) {
  const [locating, setLocating] = useState(false);
  const [addressPreview, setAddressPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function previewAddress(latitude: number, longitude: number) {
    setAddressPreview(null);
    const result = await reverseGeocodeAction({ latitude, longitude });
    if (result.success) setAddressPreview(result.address ?? "Unknown address near this point");
  }

  function useMyLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Your browser does not support location services.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        onChange({ ...value, latitude, longitude });
        setLocating(false);
        void previewAddress(latitude, longitude);
      },
      () => {
        setError("Couldn't get your location. Click a point on the map instead.");
        setLocating(false);
      },
    );
  }

  function handleMapClick(point: { latitude: number; longitude: number }) {
    const latitude = Number(point.latitude.toFixed(6));
    const longitude = Number(point.longitude.toFixed(6));
    onChange({ ...value, latitude, longitude });
    void previewAddress(latitude, longitude);
  }

  function clearLocation() {
    onChange({ ...value, latitude: undefined, longitude: undefined, radiusKm: undefined });
    setAddressPreview(null);
  }

  const markers: MapMarker[] =
    value.latitude !== undefined && value.longitude !== undefined
      ? [{ id: "search-point", latitude: value.latitude, longitude: value.longitude, variant: "current" }]
      : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={useMyLocation} disabled={locating}>
          {locating ? "Locating…" : "Use my location"}
        </Button>
        {value.latitude !== undefined && (
          <Button type="button" variant="ghost" size="sm" onClick={clearLocation}>
            Clear
          </Button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <InteractiveMap markers={markers} onMapClick={handleMapClick} heightClassName="h-64" />

      {value.latitude !== undefined && value.longitude !== undefined && (
        <p className="text-xs text-foreground/60">
          {addressPreview ? `Near ${addressPreview}` : `${value.latitude}, ${value.longitude}`}
        </p>
      )}

      {value.latitude !== undefined && (
        <div className="flex flex-col gap-1">
          <label htmlFor="radiusKm" className="text-sm font-medium">
            Search radius (km)
          </label>
          <input
            id="radiusKm"
            type="number"
            min={1}
            max={200}
            step={1}
            placeholder="e.g. 25"
            className="h-10 w-32 rounded-md border border-border px-3 text-sm"
            value={value.radiusKm ?? ""}
            onChange={(e) => onChange({ ...value, radiusKm: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      )}
    </div>
  );
}
