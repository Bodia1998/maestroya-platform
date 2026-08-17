import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    professionalPayoutAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

/**
 * Module 72 — Stripe Webhooks (post-audit correction).
 *
 * Targeted unit test for
 * `PrismaProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale`
 * — proves the actual Prisma call shape (a single `updateMany` whose
 * `WHERE` clause carries both the row selector and the out-of-order
 * guard) matches what that method's own doc comment and the domain
 * repository interface's doc comment promise, using the same
 * `vi.mock("@/infrastructure/database/prisma/client")` convention as the
 * suite above. Deliberately checks the exact `where`/`data` shape passed
 * to `updateMany`, not just the return value — a regression that
 * silently dropped the `OR` guard (making the write unconditional again)
 * would still return a superficially plausible `{ applied: true }` from
 * a looser assertion.
 */
describe("PrismaProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale (Module 72)", () => {
  async function freshRepository() {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const mockedPrisma = prisma as unknown as {
      professionalPayoutAccount: {
        findUnique: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
      };
    };
    mockedPrisma.professionalPayoutAccount.findUnique.mockReset();
    mockedPrisma.professionalPayoutAccount.updateMany.mockReset();
    const { PrismaProfessionalOnboardingRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository"
    );
    return { repository: new PrismaProfessionalOnboardingRepository(), mockedPrisma };
  }

  it("throws NotFoundError when no payout account row exists, without attempting the guarded write", async () => {
    const { repository, mockedPrisma } = await freshRepository();
    mockedPrisma.professionalPayoutAccount.findUnique.mockResolvedValue(null);

    await expect(
      repository.updateStripeConnectAccountIfNotStale("missing-profile", {
        stripeExpressStatus: "READY",
        stripeConnectSyncedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mockedPrisma.professionalPayoutAccount.updateMany).not.toHaveBeenCalled();
  });

  it("issues a single updateMany with a WHERE guard requiring stripeConnectSyncedAt to be null or not newer than the incoming value", async () => {
    const { repository, mockedPrisma } = await freshRepository();
    mockedPrisma.professionalPayoutAccount.findUnique.mockResolvedValue({ id: "row-1" });
    mockedPrisma.professionalPayoutAccount.updateMany.mockResolvedValue({ count: 1 });

    const incoming = new Date("2026-01-02T00:00:00Z");
    const result = await repository.updateStripeConnectAccountIfNotStale("pro-1", {
      stripeExpressStatus: "READY",
      stripeChargesEnabled: true,
      stripeConnectSyncedAt: incoming,
    });

    expect(result).toEqual({ applied: true });
    expect(mockedPrisma.professionalPayoutAccount.updateMany).toHaveBeenCalledWith({
      where: {
        professionalProfileId: "pro-1",
        OR: [{ stripeConnectSyncedAt: null }, { stripeConnectSyncedAt: { lte: incoming } }],
      },
      data: {
        stripeExpressStatus: "READY",
        stripeChargesEnabled: true,
        stripeConnectSyncedAt: incoming,
      },
    });
  });

  it("reports applied: false when the guard rejects the write (updateMany matches zero rows), without throwing", async () => {
    const { repository, mockedPrisma } = await freshRepository();
    mockedPrisma.professionalPayoutAccount.findUnique.mockResolvedValue({ id: "row-1" });
    mockedPrisma.professionalPayoutAccount.updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.updateStripeConnectAccountIfNotStale("pro-1", {
      stripeExpressStatus: "PENDING",
      stripeConnectSyncedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result).toEqual({ applied: false });
  });

  it("uses lte (not lt) so a retry carrying the identical stripeConnectSyncedAt still matches the guard", async () => {
    const { repository, mockedPrisma } = await freshRepository();
    mockedPrisma.professionalPayoutAccount.findUnique.mockResolvedValue({ id: "row-1" });
    mockedPrisma.professionalPayoutAccount.updateMany.mockResolvedValue({ count: 1 });

    const sameTimestamp = new Date("2026-01-01T00:00:00Z");
    await repository.updateStripeConnectAccountIfNotStale("pro-1", {
      stripeExpressStatus: "READY",
      stripeConnectSyncedAt: sameTimestamp,
    });

    expect(mockedPrisma.professionalPayoutAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ stripeConnectSyncedAt: { lte: sameTimestamp } }]),
        }),
      }),
    );
  });
});
