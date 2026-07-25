import { describe, expect, it } from "vitest";

import { DEFAULT_FUZZ_GRID_DEGREES, fuzzCoordinate } from "@/domain/services/coordinate-fuzzing";
import { haversineDistanceKm } from "@/domain/services/geo-distance";

// Maps & Geolocation module (Module 20).
const GANDIA = { latitude: 38.9665, longitude: -0.1817 };

describe("fuzzCoordinate", () => {
  it("is deterministic — the same input always fuzzes to the same output", () => {
    expect(fuzzCoordinate(GANDIA)).toEqual(fuzzCoordinate(GANDIA));
  });

  it("snaps to the fuzz grid (a multiple of the grid size)", () => {
    const fuzzed = fuzzCoordinate(GANDIA);
    const latSteps = fuzzed.latitude / DEFAULT_FUZZ_GRID_DEGREES;
    const lonSteps = fuzzed.longitude / DEFAULT_FUZZ_GRID_DEGREES;
    expect(Math.abs(latSteps - Math.round(latSteps))).toBeLessThan(1e-6);
    expect(Math.abs(lonSteps - Math.round(lonSteps))).toBeLessThan(1e-6);
  });

  it("stays within one grid cell of the true coordinate", () => {
    const fuzzed = fuzzCoordinate(GANDIA);
    expect(Math.abs(fuzzed.latitude - GANDIA.latitude)).toBeLessThanOrEqual(DEFAULT_FUZZ_GRID_DEGREES / 2 + 1e-9);
    expect(Math.abs(fuzzed.longitude - GANDIA.longitude)).toBeLessThanOrEqual(DEFAULT_FUZZ_GRID_DEGREES / 2 + 1e-9);
  });

  it("never returns a point identical to a precise coordinate with more precision than the grid allows", () => {
    // Two points ~600m apart (well within the same ~5.6km fuzz cell) must
    // fuzz to the exact same point — this is the whole privacy property.
    const nearby = { latitude: GANDIA.latitude + 0.005, longitude: GANDIA.longitude + 0.005 };
    expect(fuzzCoordinate(GANDIA)).toEqual(fuzzCoordinate(nearby));
  });

  it("keeps the fuzzed point coarser than the ranking engine's own EXACT_CITY coordinate band (15km)", () => {
    const fuzzed = fuzzCoordinate(GANDIA);
    const driftKm = haversineDistanceKm(GANDIA, fuzzed);
    expect(driftKm).toBeLessThan(15);
  });

  it("accepts a custom grid size", () => {
    const coarse = fuzzCoordinate(GANDIA, 1);
    const fine = fuzzCoordinate(GANDIA, 0.01);
    expect(coarse).not.toEqual(fine);
  });
});
