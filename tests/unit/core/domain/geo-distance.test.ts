import { describe, expect, it } from "vitest";

import { haversineDistanceKm, isWithinServiceRadius } from "@/domain/services/geo-distance";

// Gandia, Spain
const GANDIA = { latitude: 38.9665, longitude: -0.1817 };
// Oliva, Spain — a real ~15km neighbor of Gandia, used to sanity-check the
// Haversine formula against a known-ish real-world distance.
const OLIVA = { latitude: 38.9214, longitude: -0.1174 };

describe("haversineDistanceKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistanceKm(GANDIA, GANDIA)).toBe(0);
  });

  it("is symmetric (order of points does not matter)", () => {
    const ab = haversineDistanceKm(GANDIA, OLIVA);
    const ba = haversineDistanceKm(OLIVA, GANDIA);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it("computes a realistic distance between two nearby Spanish towns", () => {
    const distance = haversineDistanceKm(GANDIA, OLIVA);
    // Gandia <-> Oliva is roughly 8-10km as the crow flies.
    expect(distance).toBeGreaterThan(5);
    expect(distance).toBeLessThan(15);
  });

  it("computes an exact known distance along a meridian", () => {
    // 1 degree of latitude is ~111.19 km, regardless of longitude.
    const a = { latitude: 0, longitude: 0 };
    const b = { latitude: 1, longitude: 0 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(111.19, 0);
  });

  it("is deterministic", () => {
    const first = haversineDistanceKm(GANDIA, OLIVA);
    const second = haversineDistanceKm(GANDIA, OLIVA);
    expect(first).toBe(second);
  });
});

describe("isWithinServiceRadius", () => {
  it("includes a professional whose distance is within their own radius", () => {
    // ~5km apart in this fixture pair (see distance calc above), radius 30km.
    expect(isWithinServiceRadius(GANDIA, OLIVA, 30)).toBe(true);
  });

  it("excludes a professional whose distance exceeds their own radius", () => {
    expect(isWithinServiceRadius(GANDIA, OLIVA, 1)).toBe(false);
  });

  it("includes a professional exactly at the radius boundary", () => {
    const distance = haversineDistanceKm(GANDIA, OLIVA);
    expect(isWithinServiceRadius(GANDIA, OLIVA, distance)).toBe(true);
  });
});
