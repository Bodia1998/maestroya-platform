import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError } from "@/domain/errors/domain-error";

/**
 * `completeProfessionalOnboardingAction` (src/app/(dashboard)/dashboard/
 * professional/actions.ts) is a thin Server Action: auth, zod-validate,
 * delegate to `CompleteProfessionalOnboardingUseCase`, translate errors.
 * The use case itself is already covered end-to-end (with real
 * validation/orchestration logic) by
 * tests/integration/professional/onboarding-flows.test.ts — these tests
 * mock that one collaborator (plus `requireAuth`/`revalidatePath`, which
 * every action in this file already depends on) to verify the action's
 * own, narrow responsibilities: auth is required, invalid input never
 * reaches the use case, and both known (DomainError) and unexpected
 * errors are translated the same way every other action.ts in this
 * codebase already does.
 */
const mockRequireAuth = vi.fn();
const mockExecute = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock("@/infrastructure/auth/rbac", () => ({
  requireAuth: () => mockRequireAuth(),
}));

vi.mock("@/application/use-cases/professional/compose", () => ({
  makeCompleteProfessionalOnboardingUseCase: () => ({ execute: mockExecute }),
  makeCreateProfessionalUseCase: vi.fn(),
  makeDeactivateProfessionalUseCase: vi.fn(),
  makeUpdateProfessionalServicesUseCase: vi.fn(),
  makeUpdateProfessionalUseCase: vi.fn(),
}));

const { completeProfessionalOnboardingAction } = await import(
  "../../../src/app/(dashboard)/dashboard/professional/actions"
);

const validSubmission = {
  categoryIds: ["123e4567-e89b-12d3-a456-426614174000"],
  contactPhone: "+34600000000",
  bio: "10 years fixing pipes across the Valencia region.",
  serviceRadiusKm: 20,
  address: {
    line1: "Carrer Major 12",
    city: "Gandia",
    province: "Valencia",
    postalCode: "46700",
    country: "ES",
  },
};

describe("completeProfessionalOnboardingAction", () => {
  beforeEach(() => {
    mockRequireAuth.mockReset().mockResolvedValue({ id: "user-1", email: "a@b.com", roles: [] });
    mockExecute.mockReset();
    mockRevalidatePath.mockReset();
  });

  it("delegates to the use case and revalidates both professional pages on success", async () => {
    mockExecute.mockResolvedValue({ id: "prof-1", userId: "user-1" });

    const result = await completeProfessionalOnboardingAction(validSubmission);

    expect(result).toEqual({ success: true });
    expect(mockExecute).toHaveBeenCalledWith("user-1", expect.objectContaining(validSubmission));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/professional");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/professional/onboarding");
  });

  it("returns field errors for an invalid submission without ever calling the use case", async () => {
    const result = await completeProfessionalOnboardingAction({
      ...validSubmission,
      categoryIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors).toBeDefined();
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("surfaces a DomainError's own message", async () => {
    mockExecute.mockRejectedValue(new ConflictError("A professional profile already exists for this account."));

    const result = await completeProfessionalOnboardingAction(validSubmission);

    expect(result).toEqual({
      success: false,
      error: "A professional profile already exists for this account.",
    });
  });

  it("falls back to a generic message for an unexpected error, without leaking internals", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("connection refused"));

    const result = await completeProfessionalOnboardingAction(validSubmission);

    expect(result).toEqual({
      success: false,
      error: "Something went wrong setting up your professional profile.",
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("requires authentication before doing anything else", async () => {
    mockRequireAuth.mockRejectedValue(new Error("You must be signed in to do that."));

    await expect(completeProfessionalOnboardingAction(validSubmission)).rejects.toThrow();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
