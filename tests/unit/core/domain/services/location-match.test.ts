import { describe, expect, it } from "vitest";

import { computeCoordinateLocationMatch, computeLocationMatch } from "@/domain/services/location-match";

describe("computeLocationMatch", () => {
  it("matches EXACT_CITY case-insensitively", () => {
    expect(computeLocationMatch({ city: "Gandia" }, { city: "GANDIA" })).toBe("EXACT_CITY");
  });

  it("matches EXACT_CITY with surrounding whitespace", () => {
    expect(computeLocationMatch({ city: " Gandia " }, { city: "gandia" })).toBe("EXACT_CITY");
  });

  it("falls back to SAME_PROVINCE when cities differ but province matches", () => {
    expect(
      computeLocationMatch({ city: "Oliva", province: "Valencia" }, { city: "Gandia", province: "Valencia" }),
    ).toBe("SAME_PROVINCE");
  });

  it("prefers EXACT_CITY over SAME_PROVINCE when both would match", () => {
    expect(
      computeLocationMatch(
        { city: "Gandia", province: "Valencia" },
        { city: "Gandia", province: "Valencia" },
      ),
    ).toBe("EXACT_CITY");
  });

  it("returns NONE when neither city nor province match", () => {
    expect(
      computeLocationMatch({ city: "Gandia", province: "Valencia" }, { city: "Madrid", province: "Madrid" }),
    ).toBe("NONE");
  });

  it("returns NONE (not a penalty-free skip) when no query location was given", () => {
    expect(computeLocationMatch({}, { city: "Gandia", province: "Valencia" })).toBe("NONE");
  });

  it("returns NONE when the candidate has no location at all", () => {
    expect(computeLocationMatch({ city: "Gandia" }, { city: null, province: null })).toBe("NONE");
  });
});

describe("computeCoordinateLocationMatch", () => {
  const GANDIA = { latitude: 38.9665, longitude: -0.1817 };
  const FARTHER_VALENCIA_POINT = { latitude: 38.9907, longitude: -0.5185 };

  it("returns null when either point is missing (Module 20 not required)", () => {
    expect(computeCoordinateLocationMatch(null, GANDIA)).toBeNull();
    expect(computeCoordinateLocationMatch(GANDIA, null)).toBeNull();
  });

  it("returns EXACT_CITY for points within 15km", () => {
    expect(computeCoordinateLocationMatch(GANDIA, GANDIA)).toBe("EXACT_CITY");
  });

  it("returns SAME_PROVINCE for points further than 15km but within 60km", () => {
    expect(computeCoordinateLocationMatch(GANDIA, FARTHER_VALENCIA_POINT)).toBe("SAME_PROVINCE");
  });

  it("returns NONE for points beyond 60km", () => {
    // Madrid is well beyond 60km from Gandia.
    const farAway = { latitude: 40.4168, longitude: -3.7038 };
    expect(computeCoordinateLocationMatch(GANDIA, farAway)).toBe("NONE");
  });
});
