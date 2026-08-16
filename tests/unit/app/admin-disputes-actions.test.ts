import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objective E
 * — segregation of duties): authorization tests for
 * `resolveDisputeWithFinancialOutcomeAction` — the Module 70 audit found
 * `ROLES.SUPPORT` included alongside `ADMIN`/`SUPER_ADMIN` on this one
 * financial-outcome-authorizing action; this module's fix narrows it to
 * `ADMIN`/`SUPER_ADMIN` only (see actions.ts's own doc comment on that
 * export for the full rationale). Same mock-`requireRole`-and-the-use-case
 * pattern as professional-onboarding-actions.test.ts — this file verifies
 * only the Server Action's own authorization boundary, not
 * `ResolveDisputeWithFinancialOutcomeUseCase`'s orchestration (already
 * covered elsewhere).
 */
const mockRequireRole = vi.fn();
const mockExecute = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock("@/infrastructure/auth/rbac", () => ({
  ROLES: { ADMIN: "ADMIN", SUPER_ADMIN: "SUPER_ADMIN", SUPPORT: "SUPPORT" },
  requireRole: (...allowed: string[]) => mockRequireRole(...allowed),
}));

vi.mock("@/application/use-cases/dispute-resolution/compose", () => ({
  makeResolveDisputeWithFinancialOutcomeUseCase: () => ({ execute: mockExecute }),
}));

vi.mock("@/application/use-cases/dispute/compose", () => ({
  makeAddDisputeInternalNoteUseCase: vi.fn(),
  makeAssignDisputeUseCase: vi.fn(),
  makeChangeDisputeStatusUseCase: vi.fn(),
  makeCloseDisputeUseCase: vi.fn(),
  makeGetAdminDisputeUseCase: vi.fn(),
  makeListAdminDisputesUseCase: vi.fn(),
  makeRejectDisputeUseCase: vi.fn(),
  makeResolveDisputeUseCase: vi.fn(),
}));

const { resolveDisputeWithFinancialOutcomeAction } = await import(
  "../../../src/app/(dashboard)/admin/disputes/actions"
);
const { UnauthorizedError } = await import("../../../src/core/domain/errors/domain-error");

describe("resolveDisputeWithFinancialOutcomeAction — authorization (Module 70.1, Objective E)", () => {
  beforeEach(() => {
    mockRequireRole.mockReset();
    mockExecute.mockReset();
    mockRevalidatePath.mockReset();
  });

  it("requires only ADMIN/SUPER_ADMIN — SUPPORT is deliberately excluded from this specific call's allowed roles", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockExecute.mockResolvedValue({ id: "decision-1" });

    await resolveDisputeWithFinancialOutcomeAction({
      disputeId: "11111111-1111-1111-1111-111111111111",
      resolution: "CUSTOMER_FAVOR",
      resolutionNote: "Refund approved.",
    });

    expect(mockRequireRole).toHaveBeenCalledWith("ADMIN", "SUPER_ADMIN");
    expect(mockRequireRole).not.toHaveBeenCalledWith(expect.arrayContaining(["SUPPORT"]));
  });

  it("SUPPORT is denied — requireRole throws UnauthorizedError, and the use case is never reached", async () => {
    mockRequireRole.mockRejectedValue(new UnauthorizedError("You do not have permission to do that."));

    await expect(
      resolveDisputeWithFinancialOutcomeAction({
        disputeId: "11111111-1111-1111-1111-111111111111",
        resolution: "CUSTOMER_FAVOR",
        resolutionNote: "Refund approved.",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("ADMIN succeeds and reaches the use case", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockExecute.mockResolvedValue({ id: "decision-2" });

    const result = await resolveDisputeWithFinancialOutcomeAction({
      disputeId: "22222222-2222-2222-2222-222222222222",
      resolution: "PROFESSIONAL_FAVOR",
      resolutionNote: "No fault found.",
    });

    expect(result.success).toBe(true);
    expect(mockExecute).toHaveBeenCalled();
  });

  it("SUPER_ADMIN succeeds and reaches the use case", async () => {
    mockRequireRole.mockResolvedValue({ id: "super-admin-1" });
    mockExecute.mockResolvedValue({ id: "decision-3" });

    const result = await resolveDisputeWithFinancialOutcomeAction({
      disputeId: "33333333-3333-3333-3333-333333333333",
      resolution: "CUSTOMER_FAVOR",
      resolutionNote: "Refund approved.",
    });

    expect(result.success).toBe(true);
  });
});
