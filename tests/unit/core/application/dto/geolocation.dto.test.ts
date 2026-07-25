import { describe, expect, it } from "vitest";

import { geocodeCitySchema } from "@/application/dto/geolocation.dto";

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
