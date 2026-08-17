import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    professionalPayoutAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

/**
 * Module 71 — Stripe Connect.
 *
 * Small, targeted unit test for
 * `PrismaProfessionalOnboardingRepository.updateStripeConnectAccount` —
 * specifically its `NotFoundError` behavior when no
 * `ProfessionalPayoutAccount` row exists yet for the given professional
 * profile id. Same `vi.mock("@/infrastructure/database/prisma/client")`
 * convention as `prisma-backup-record-repository.test.ts`; deliberately
 * narrow in scope per the module brief (no broader repository test suite
 * added here).
 */
describe("PrismaProfessionalOnboardingRepository.updateStripeConnectAccount", () => {
  it("throws NotFoundError when no payout account exists for the professional profile id", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (
      prisma as unknown as { professionalPayoutAccount: { findUnique: ReturnType<typeof vi.fn> } }
    ).professionalPayoutAccount.findUnique.mockResolvedValue(null);

    const { PrismaProfessionalOnboardingRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository"
    );
    const repository = new PrismaProfessionalOnboardingRepository();

    await expect(
      repository.updateStripeConnectAccount("missing-profile", { stripeExpressStatus: "READY" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(
      (prisma as unknown as { professionalPayoutAccount: { update: ReturnType<typeof vi.fn> } })
        .professionalPayoutAccount.update,
    ).not.toHaveBeenCalled();
  });
});
