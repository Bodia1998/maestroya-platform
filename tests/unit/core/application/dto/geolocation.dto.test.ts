import { describe, expect, it } from "vitest";

import { geocodeCitySchema, reverseGeocodeSchema } from "@/application/dto/geolocation.dto";

/** Maps & Geolocation module (Module 20). */
describe("geocodeCitySchema", () => {
  it("accepts a city without a province", () => {
    expect(geocodeCitySchema.safeParse({ city: "Gandia" }).success).toBe(true);
  });

  it("accepts a city with a province", () => {
    expect(geocodeCitySchema.safeParse({ city: "Gandia", province: "Valencia" }).success).toBe(true);
  });

  it("rejects a missing city", () => {
    expect(geocodeCitySchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty-string city", () => {
    expect(geocodeCitySchema.safeParse({ city: "   " }).success).toBe(false);
  });

  it("rejects a pathologically long city name (abuse prevention)", () => {
    expect(geocodeCitySchema.safeParse({ city: "a".repeat(101) }).success).toBe(false);
  });

  it("treats an empty-string province as absent", () => {
    const result = geocodeCitySchema.safeParse({ city: "Gandia", province: "  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.province).toBeUndefined();
  });
});

/** Module 42 — Geocoding & Maps. */
describe("reverseGeocodeSchema", () => {
  it("accepts a valid latitude/longitude pair", () => {
    const result = reverseGeocodeSchema.safeParse({ latitude: 38.9665, longitude: -0.1817 });
    expect(result.success).toBe(true);
  });

  it("coerces numeric strings, matching searchDirectorySchema's own lat/lng coercion", () => {
    const result = reverseGeocodeSchema.safeParse({ latitude: "38.9665", longitude: "-0.1817" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ latitude: 38.9665, longitude: -0.1817 });
  });

  it("rejects a missing latitude or longitude", () => {
    expect(reverseGeocodeSchema.safeParse({ longitude: -0.1817 }).success).toBe(false);
    expect(reverseGeocodeSchema.safeParse({ latitude: 38.9665 }).success).toBe(false);
  });

  it("rejects an out-of-range latitude", () => {
    expect(reverseGeocodeSchema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
    expect(reverseGeocodeSchema.safeParse({ latitude: -91, longitude: 0 }).success).toBe(false);
  });

  it("rejects an out-of-range longitude", () => {
    expect(reverseGeocodeSchema.safeParse({ latitude: 0, longitude: 181 }).success).toBe(false);
    expect(reverseGeocodeSchema.safeParse({ latitude: 0, longitude: -181 }).success).toBe(false);
  });

  it("rejects a non-numeric value", () => {
    expect(reverseGeocodeSchema.safeParse({ latitude: "not-a-number", longitude: 0 }).success).toBe(false);
  });
});
