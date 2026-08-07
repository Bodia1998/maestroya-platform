import { describe, expect, it, vi } from "vitest";

/**
 * Module 42 — Geocoding & Maps.
 *
 * `reverseGeocodeAction` (src/app/(marketing)/search/actions.ts) is a thin
 * Server Action: zod-validate, delegate to `ReverseGeocodeUseCase`,
 * translate errors — the same "mock the one collaborator, verify the
 * action's own narrow responsibilities" convention
 * `professional-onboarding-actions.test.ts` already established for this
 * codebase's other Server Actions. No `requireAuth` here, matching
 * `ReverseGeocodeUseCase`'s own "not account-scoped data" reasoning — this
 * action is intentionally unauthenticated, same as the `/search` page it
 * supports.
 */
const mockExecute = vi.fn();

vi.mock("@/application/use-cases/geolocation/compose", () => ({
  makeReverseGeocodeUseCase: () => ({ execute: mockExecute }),
  makeGeocodeCityUseCase: vi.fn(),
}));

const { reverseGeocodeAction } = await import("../../../src/app/(marketing)/search/actions");

describe("reverseGeocodeAction", () => {
  it("rejects an invalid coordinate before it ever reaches the use case", async () => {
    const result = await reverseGeocodeAction({ latitude: 999, longitude: 0 });

    expect(result).toEqual({ success: false, error: "That location looks invalid." });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns a human-readable address label on success", async () => {
    mockExecute.mockResolvedValueOnce({
      address: { line1: "Carrer Major 12", city: "Gandia", province: "Valencia" },
      point: { latitude: 38.9665, longitude: -0.1817 },
    });

    const result = await reverseGeocodeAction({ latitude: 38.9665, longitude: -0.1817 });

    expect(result).toEqual({
      success: true,
      address: "Carrer Major 12, Gandia, Valencia",
      latitude: 38.9665,
      longitude: -0.1817,
    });
  });

  it("succeeds with a null address when the provider can't resolve the point", async () => {
    mockExecute.mockResolvedValueOnce(null);

    const result = await reverseGeocodeAction({ latitude: 0, longitude: 0 });

    expect(result).toEqual({ success: true, address: null, latitude: 0, longitude: 0 });
  });

  it("translates an unexpected use-case error into a generic, safe message", async () => {
    mockExecute.mockRejectedValueOnce(new Error("boom"));

    const result = await reverseGeocodeAction({ latitude: 38.9665, longitude: -0.1817 });

    expect(result).toEqual({ success: false, error: "Couldn't resolve an address for that location." });
  });
});
