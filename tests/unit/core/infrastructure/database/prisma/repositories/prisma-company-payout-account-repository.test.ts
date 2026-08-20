import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    companyPayoutAccount: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

/**
 * Module 75 — Company Payout Eligibility.
 *
 * Small, targeted unit test for `PrismaCompanyPayoutAccountRepository` —
 * same `vi.mock("@/infrastructure/database/prisma/client")` convention as
 * `prisma-professional-onboarding-repository.test.ts` (Module 71/72),
 * which this repository mirrors.
 */
describe("PrismaCompanyPayoutAccountRepository", () => {
  it("resolves null when no payout account exists for the company profile id", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { companyPayoutAccount: { findUnique: ReturnType<typeof vi.fn> } }).companyPayoutAccount.findUnique.mockResolvedValue(
      null,
    );

    const { PrismaCompanyPayoutAccountRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-company-payout-account-repository"
    );
    const repository = new PrismaCompanyPayoutAccountRepository();

    await expect(repository.findByCompanyProfileId("missing-company")).resolves.toBeNull();
  });

  it("throws NotFoundError from updateStripeConnectAccount when no payout account row exists", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { companyPayoutAccount: { findUnique: ReturnType<typeof vi.fn> } }).companyPayoutAccount.findUnique.mockResolvedValue(
      null,
    );

    const { PrismaCompanyPayoutAccountRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-company-payout-account-repository"
    );
    const repository = new PrismaCompanyPayoutAccountRepository();

    await expect(
      repository.updateStripeConnectAccount("missing-company", { stripeExpressStatus: "READY" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(
      (prisma as unknown as { companyPayoutAccount: { update: ReturnType<typeof vi.fn> } }).companyPayoutAccount.update,
    ).not.toHaveBeenCalled();
  });

  it("upsertPayoutAccount clears Stripe-mirrored fields when switching away from STRIPE_EXPRESS", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const upsertMock = (
      prisma as unknown as { companyPayoutAccount: { upsert: ReturnType<typeof vi.fn> } }
    ).companyPayoutAccount.upsert;
    upsertMock.mockResolvedValue({
      id: "cpa-1",
      companyProfileId: "company-1",
      method: "IBAN",
      status: "PENDING",
      accountHolderName: "Acme Corp",
      ibanLast4: "1234",
      ibanHash: "hash",
      stripeExpressAccountId: null,
      stripeExpressStatus: "NOT_STARTED",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false,
      stripeRequirementsCurrentlyDue: false,
      stripeConnectSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { PrismaCompanyPayoutAccountRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-company-payout-account-repository"
    );
    const repository = new PrismaCompanyPayoutAccountRepository();

    await repository.upsertPayoutAccount({
      companyProfileId: "company-1",
      method: "IBAN",
      status: "PENDING",
      accountHolderName: "Acme Corp",
      ibanLast4: "1234",
      ibanHash: "hash",
    });

    const callArgs = upsertMock.mock.calls[0]![0];
    expect(callArgs.update.stripeExpressAccountId).toBeNull();
    expect(callArgs.update.stripeChargesEnabled).toBe(false);
    expect(callArgs.where).toEqual({ companyProfileId: "company-1" });
  });
});
