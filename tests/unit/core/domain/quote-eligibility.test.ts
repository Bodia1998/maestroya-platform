import { describe, expect, it } from "vitest";

import { distanceToRequestKm, isProfessionalEligibleForRequest } from "@/domain/services/quote-eligibility";

const PLUMBING = "cat-plumbing";
const ELECTRICAL = "cat-electrical";

// Gandia / Oliva, Spain — same fixture pair as geo-distance.test.ts (~8-10km apart).
const GANDIA = { latitude: 38.9665, longitude: -0.1817 };
const OLIVA = { latitude: 38.9214, longitude: -0.1174 };

function professional(overrides: Partial<Parameters<typeof isProfessionalEligibleForRequest>[0]> = {}) {
  return {
    categoryIds: [PLUMBING],
    latitude: GANDIA.latitude,
    longitude: GANDIA.longitude,
    serviceRadiusKm: 30,
    ...overrides,
  };
}

function request(overrides: Partial<Parameters<typeof isProfessionalEligibleForRequest>[1]> = {}) {
  return {
    categoryId: PLUMBING,
    latitude: OLIVA.latitude,
    longitude: OLIVA.longitude,
    ...overrides,
  };
}

describe("isProfessionalEligibleForRequest", () => {
  it("is eligible when category matches and request is within radius", () => {
    expect(isProfessionalEligibleForRequest(professional(), request())).toBe(true);
  });

  it("is ineligible when the request's category isn't one of the professional's", () => {
    expect(
      isProfessionalEligibleForRequest(professional({ categoryIds: [ELECTRICAL] }), request()),
    ).toBe(false);
  });

  it("is ineligible when the request is outside the professional's radius", () => {
    expect(isProfessionalEligibleForRequest(professional({ serviceRadiusKm: 1 }), request())).toBe(false);
  });

  it("is ineligible when the professional has no configured service radius", () => {
    expect(isProfessionalEligibleForRequest(professional({ serviceRadiusKm: null }), request())).toBe(
      false,
    );
  });

  it("is ineligible when the professional has no base coordinates", () => {
    expect(
      isProfessionalEligibleForRequest(professional({ latitude: null, longitude: null }), request()),
    ).toBe(false);
  });

  it("is ineligible when the request has no coordinates", () => {
    expect(
      isProfessionalEligibleForRequest(professional(), request({ latitude: null, longitude: null })),
    ).toBe(false);
  });
});

describe("distanceToRequestKm", () => {
  it("returns a realistic distance for two nearby Spanish towns", () => {
    const distance = distanceToRequestKm(professional(), request());
    expect(distance).not.toBeNull();
    expect(distance as number).toBeGreaterThan(5);
    expect(distance as number).toBeLessThan(15);
  });

  it("returns null when either side is missing coordinates", () => {
    expect(distanceToRequestKm(professional({ latitude: null }), request())).toBeNull();
    expect(distanceToRequestKm(professional(), request({ longitude: null }))).toBeNull();
  });
});
