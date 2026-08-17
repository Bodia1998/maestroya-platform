import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  OnboardingStatusValue,
  PayoutAccountStatusValue,
  PayoutMethodValue,
  StripeExpressReadinessValue,
} from "@/domain/services/professional-onboarding-rules";
import { NotFoundError } from "@/domain/errors/domain-error";
import type {
  CreatePayoutAccountData,
  ProfessionalOnboardingRecord,
  ProfessionalOnboardingRepository,
  ProfessionalPayoutAccountRecord,
  UpdateStripeConnectAccountData,
} from "@/domain/repositories/professional-onboarding-repository";

/**
 * Module 62 — Professional Onboarding: Prisma implementation of
 * `ProfessionalOnboardingRepository`, backed by the `professional_
 * onboardings` / `professional_payout_accounts` tables added by this
 * module's migration (see prisma/schema.prisma). Same "narrow SELECT +
 * toRecord mapper" convention as `PrismaProfessionalVerificationRepository`
 * (Module 17).
 */

const ONBOARDING_SELECT = {
  id: true,
  professionalProfileId: true,
  status: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PAYOUT_ACCOUNT_SELECT = {
  id: true,
  professionalProfileId: true,
  method: true,
  status: true,
  accountHolderName: true,
  ibanLast4: true,
  ibanHash: true,
  stripeExpressAccountId: true,
  stripeExpressStatus: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  stripeRequirementsCurrentlyDue: true,
  stripeConnectSyncedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type OnboardingRow = {
  id: string;
  professionalProfileId: string;
  status: string;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PayoutAccountRow = {
  id: string;
  professionalProfileId: string;
  method: string;
  status: string;
  accountHolderName: string;
  ibanLast4: string | null;
  ibanHash: string | null;
  stripeExpressAccountId: string | null;
  stripeExpressStatus: string;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeRequirementsCurrentlyDue: boolean;
  stripeConnectSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toOnboardingRecord(row: OnboardingRow): ProfessionalOnboardingRecord {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    status: row.status as OnboardingStatusValue,
    activatedAt: row.activatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPayoutAccountRecord(row: PayoutAccountRow): ProfessionalPayoutAccountRecord {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    method: row.method as PayoutMethodValue,
    status: row.status as PayoutAccountStatusValue,
    accountHolderName: row.accountHolderName,
    ibanLast4: row.ibanLast4,
    ibanHash: row.ibanHash,
    stripeExpressAccountId: row.stripeExpressAccountId,
    stripeExpressStatus: row.stripeExpressStatus as StripeExpressReadinessValue,
    stripeChargesEnabled: row.stripeChargesEnabled,
    stripePayoutsEnabled: row.stripePayoutsEnabled,
    stripeDetailsSubmitted: row.stripeDetailsSubmitted,
    stripeRequirementsCurrentlyDue: row.stripeRequirementsCurrentlyDue,
    stripeConnectSyncedAt: row.stripeConnectSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaProfessionalOnboardingRepository implements ProfessionalOnboardingRepository {
  async findByProfessionalProfileId(professionalProfileId: string): Promise<ProfessionalOnboardingRecord | null> {
    const row = await prisma.professionalOnboarding.findUnique({
      where: { professionalProfileId },
      select: ONBOARDING_SELECT,
    });
    return row ? toOnboardingRecord(row) : null;
  }

  async create(professionalProfileId: string): Promise<ProfessionalOnboardingRecord> {
    const row = await prisma.professionalOnboarding.create({
      data: { professionalProfileId, status: "IN_PROGRESS" },
      select: ONBOARDING_SELECT,
    });
    return toOnboardingRecord(row);
  }

  async activate(id: string, activatedAt: Date): Promise<ProfessionalOnboardingRecord> {
    const existing = await prisma.professionalOnboarding.findUnique({ where: { id }, select: ONBOARDING_SELECT });
    if (existing?.status === "ACTIVATED") {
      // Idempotent: already activated — see ProfessionalOnboardingRepository
      // .activate's own doc comment.
      return toOnboardingRecord(existing);
    }
    const row = await prisma.professionalOnboarding.update({
      where: { id },
      data: { status: "ACTIVATED", activatedAt },
      select: ONBOARDING_SELECT,
    });
    return toOnboardingRecord(row);
  }

  async findPayoutAccountByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalPayoutAccountRecord | null> {
    const row = await prisma.professionalPayoutAccount.findUnique({
      where: { professionalProfileId },
      select: PAYOUT_ACCOUNT_SELECT,
    });
    return row ? toPayoutAccountRecord(row) : null;
  }

  async findPayoutAccountByStripeAccountId(stripeAccountId: string): Promise<ProfessionalPayoutAccountRecord | null> {
    const row = await prisma.professionalPayoutAccount.findUnique({
      where: { stripeExpressAccountId: stripeAccountId },
      select: PAYOUT_ACCOUNT_SELECT,
    });
    return row ? toPayoutAccountRecord(row) : null;
  }

  async upsertPayoutAccount(data: CreatePayoutAccountData): Promise<ProfessionalPayoutAccountRecord> {
    // Module 71 — Stripe Connect: switching *away* from STRIPE_EXPRESS
    // (e.g. back to IBAN) clears every Stripe-mirrored field — a
    // professional no longer using Stripe as their payout destination
    // must not keep reporting a stale `stripeExpressAccountId`/
    // `stripeChargesEnabled`/`stripePayoutsEnabled` from a previous,
    // now-unrelated destination. Re-submitting the *same* STRIPE_EXPRESS
    // selection (e.g. only changing `accountHolderName`) deliberately
    // leaves any already-connected account's Stripe-mirrored fields
    // untouched — this method is not the place account creation/status
    // sync happens (see `CreateStripeConnectedAccountUseCase`/
    // `GetStripeAccountStatusUseCase`), and clearing them here would
    // orphan a real Stripe account the platform already created.
    const clearStripeFields = data.method !== "STRIPE_EXPRESS";
    const row = await prisma.professionalPayoutAccount.upsert({
      where: { professionalProfileId: data.professionalProfileId },
      create: {
        professionalProfileId: data.professionalProfileId,
        method: data.method,
        status: data.status,
        accountHolderName: data.accountHolderName,
        ibanLast4: data.ibanLast4 ?? null,
        ibanHash: data.ibanHash ?? null,
        stripeExpressStatus: data.stripeExpressStatus ?? "NOT_STARTED",
      },
      update: {
        method: data.method,
        status: data.status,
        accountHolderName: data.accountHolderName,
        ibanLast4: data.ibanLast4 ?? null,
        ibanHash: data.ibanHash ?? null,
        stripeExpressStatus: data.stripeExpressStatus ?? "NOT_STARTED",
        ...(clearStripeFields
          ? {
              stripeExpressAccountId: null,
              stripeChargesEnabled: false,
              stripePayoutsEnabled: false,
              stripeDetailsSubmitted: false,
              stripeRequirementsCurrentlyDue: false,
              stripeConnectSyncedAt: null,
            }
          : {}),
      },
      select: PAYOUT_ACCOUNT_SELECT,
    });
    return toPayoutAccountRecord(row);
  }

  async updateStripeConnectAccount(
    professionalProfileId: string,
    data: UpdateStripeConnectAccountData,
  ): Promise<ProfessionalPayoutAccountRecord> {
    const existing = await prisma.professionalPayoutAccount.findUnique({ where: { professionalProfileId } });
    if (!existing) {
      throw new NotFoundError("ProfessionalPayoutAccount", professionalProfileId);
    }
    const row = await prisma.professionalPayoutAccount.update({
      where: { professionalProfileId },
      data: {
        ...(data.stripeExpressAccountId !== undefined ? { stripeExpressAccountId: data.stripeExpressAccountId } : {}),
        ...(data.stripeExpressStatus !== undefined ? { stripeExpressStatus: data.stripeExpressStatus } : {}),
        ...(data.stripeChargesEnabled !== undefined ? { stripeChargesEnabled: data.stripeChargesEnabled } : {}),
        ...(data.stripePayoutsEnabled !== undefined ? { stripePayoutsEnabled: data.stripePayoutsEnabled } : {}),
        ...(data.stripeDetailsSubmitted !== undefined ? { stripeDetailsSubmitted: data.stripeDetailsSubmitted } : {}),
        ...(data.stripeRequirementsCurrentlyDue !== undefined
          ? { stripeRequirementsCurrentlyDue: data.stripeRequirementsCurrentlyDue }
          : {}),
        ...(data.stripeConnectSyncedAt !== undefined ? { stripeConnectSyncedAt: data.stripeConnectSyncedAt } : {}),
      },
      select: PAYOUT_ACCOUNT_SELECT,
    });
    return toPayoutAccountRecord(row);
  }

  /**
   * Module 72 — Stripe Webhooks (post-audit correction): a single
   * `updateMany` whose `WHERE` clause is both the row selector *and* the
   * out-of-order-delivery guard, evaluated atomically by Postgres in the
   * same statement as the write — see `ProfessionalOnboardingRepository
   * .updateStripeConnectAccountIfNotStale`'s own doc comment for why this
   * is what makes the guard race-free where a separate "read
   * `stripeConnectSyncedAt`, compare in application code, then call
   * `updateStripeConnectAccount`" sequence is not. No schema change:
   * `stripeConnectSyncedAt` is the same column Module 71 already added.
   *
   * `updateMany` (rather than `update`) is used deliberately — Prisma's
   * `update` only accepts a unique-identifier `where`, which cannot also
   * carry the `stripeConnectSyncedAt` comparison; `updateMany` accepts an
   * arbitrary `where` and reports `count`, which is exactly the "was the
   * guard satisfied" signal this method needs and `update` cannot give
   * without a second round-trip (which would itself reopen the race).
   */
  async updateStripeConnectAccountIfNotStale(
    professionalProfileId: string,
    data: UpdateStripeConnectAccountData & { stripeConnectSyncedAt: Date },
  ): Promise<{ applied: boolean }> {
    const existing = await prisma.professionalPayoutAccount.findUnique({ where: { professionalProfileId } });
    if (!existing) {
      throw new NotFoundError("ProfessionalPayoutAccount", professionalProfileId);
    }
    const result = await prisma.professionalPayoutAccount.updateMany({
      where: {
        professionalProfileId,
        // `lte`, not `lt`: a retried delivery of the SAME event (its own
        // `createdAt` exactly equal to what an earlier, already-successful
        // write for that same event persisted — e.g. the first write
        // succeeded but `markProcessed` then failed, so Stripe retries)
        // must still be accepted, never rejected as "stale" — only an
        // event strictly OLDER than the current state is out of order.
        // See `ProfessionalOnboardingRepository
        // .updateStripeConnectAccountIfNotStale`'s own doc comment.
        OR: [{ stripeConnectSyncedAt: null }, { stripeConnectSyncedAt: { lte: data.stripeConnectSyncedAt } }],
      },
      data: {
        ...(data.stripeExpressAccountId !== undefined ? { stripeExpressAccountId: data.stripeExpressAccountId } : {}),
        ...(data.stripeExpressStatus !== undefined ? { stripeExpressStatus: data.stripeExpressStatus } : {}),
        ...(data.stripeChargesEnabled !== undefined ? { stripeChargesEnabled: data.stripeChargesEnabled } : {}),
        ...(data.stripePayoutsEnabled !== undefined ? { stripePayoutsEnabled: data.stripePayoutsEnabled } : {}),
        ...(data.stripeDetailsSubmitted !== undefined ? { stripeDetailsSubmitted: data.stripeDetailsSubmitted } : {}),
        ...(data.stripeRequirementsCurrentlyDue !== undefined
          ? { stripeRequirementsCurrentlyDue: data.stripeRequirementsCurrentlyDue }
          : {}),
        stripeConnectSyncedAt: data.stripeConnectSyncedAt,
      },
    });
    return { applied: result.count > 0 };
  }

  async countByStatus(status: OnboardingStatusValue): Promise<number> {
    return prisma.professionalOnboarding.count({ where: { status } });
  }
}
