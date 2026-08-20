import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  PayoutAccountStatusValue,
  PayoutMethodValue,
  StripeExpressReadinessValue,
} from "@/domain/services/professional-onboarding-rules";
import { NotFoundError } from "@/domain/errors/domain-error";
import type {
  CompanyPayoutAccountRecord,
  CompanyPayoutAccountRepository,
  CreateCompanyPayoutAccountData,
  UpdateCompanyStripeConnectAccountData,
} from "@/domain/repositories/company-payout-account-repository";

/**
 * Module 75 — Company Payout Eligibility: Prisma implementation of
 * `CompanyPayoutAccountRepository`, backed by the `company_payout_accounts`
 * table added by this module's migration. Same "narrow SELECT + toRecord
 * mapper" convention as `PrismaProfessionalOnboardingRepository`.
 */

const PAYOUT_ACCOUNT_SELECT = {
  id: true,
  companyProfileId: true,
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

type PayoutAccountRow = {
  id: string;
  companyProfileId: string;
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

function toRecord(row: PayoutAccountRow): CompanyPayoutAccountRecord {
  return {
    id: row.id,
    companyProfileId: row.companyProfileId,
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

export class PrismaCompanyPayoutAccountRepository implements CompanyPayoutAccountRepository {
  async findByCompanyProfileId(companyProfileId: string): Promise<CompanyPayoutAccountRecord | null> {
    const row = await prisma.companyPayoutAccount.findUnique({
      where: { companyProfileId },
      select: PAYOUT_ACCOUNT_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findByStripeAccountId(stripeAccountId: string): Promise<CompanyPayoutAccountRecord | null> {
    const row = await prisma.companyPayoutAccount.findUnique({
      where: { stripeExpressAccountId: stripeAccountId },
      select: PAYOUT_ACCOUNT_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async upsertPayoutAccount(data: CreateCompanyPayoutAccountData): Promise<CompanyPayoutAccountRecord> {
    // Same "switching away from STRIPE_EXPRESS clears Stripe-mirrored
    // fields" rule as PrismaProfessionalOnboardingRepository.upsertPayoutAccount
    // — see that method's own doc comment for the full rationale.
    const clearStripeFields = data.method !== "STRIPE_EXPRESS";
    const row = await prisma.companyPayoutAccount.upsert({
      where: { companyProfileId: data.companyProfileId },
      create: {
        companyProfileId: data.companyProfileId,
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
    return toRecord(row);
  }

  async updateStripeConnectAccount(
    companyProfileId: string,
    data: UpdateCompanyStripeConnectAccountData,
  ): Promise<CompanyPayoutAccountRecord> {
    const existing = await prisma.companyPayoutAccount.findUnique({ where: { companyProfileId } });
    if (!existing) {
      throw new NotFoundError("CompanyPayoutAccount", companyProfileId);
    }
    const row = await prisma.companyPayoutAccount.update({
      where: { companyProfileId },
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
    return toRecord(row);
  }
}
