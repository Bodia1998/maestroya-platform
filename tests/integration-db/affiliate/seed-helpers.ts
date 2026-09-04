/**
 * Module 91 — Real-Database Integration Test Harness, Module 96 Financial
 * Fix Pass. Minimal, self-contained real-Postgres builders for
 * `Partner`/`AffiliateCommission` — kept local to this directory (not
 * folded into the shared `tests/test-utils/db/seed-helpers.ts`) since
 * this is the first real-DB tier test suite to need them; promote to the
 * shared file if a second suite needs the same graph.
 */
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { createUser } from "../../test-utils/db/seed-helpers";

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export async function createApprovedPartner(
  prisma: PrismaClient,
  overrides: Partial<{ payoutMethod: "MANUAL" | "STRIPE"; minimumPayoutThreshold: number }> = {},
) {
  const user = await createUser(prisma);
  const partner = await prisma.partner.create({
    data: {
      userId: user.id,
      type: "INDIVIDUAL",
      status: "APPROVED",
      displayName: `Module 96 Test Partner ${uniqueSuffix()}`,
      contactEmail: `module96-partner-${uniqueSuffix()}@test.maestroya.invalid`,
      payoutMethod: overrides.payoutMethod ?? "MANUAL",
      minimumPayoutThreshold: overrides.minimumPayoutThreshold ?? 10,
      approvedAt: new Date(),
    },
  });
  return partner;
}

/** Creates one APPROVED AffiliateCommission with no real Payment/Commission
 *  backing it — this suite tests payout/reconciliation mechanics purely at
 *  the AffiliateCommission/Transaction level, so `platformCommissionRefId`
 *  is a synthetic id (never dereferenced by the payout-race tests; the
 *  reconciliation tests that DO dereference it create a real Commission
 *  row explicitly — see that test file). */
export async function createApprovedAffiliateCommission(
  prisma: PrismaClient,
  partnerId: string,
  overrides: Partial<{ affiliateAmount: number; platformCommissionAmount: number; platformCommissionRefId: string; status: string }> = {},
) {
  const affiliateAmount = overrides.affiliateAmount ?? 10;
  const platformCommissionAmount = overrides.platformCommissionAmount ?? 100;
  return prisma.affiliateCommission.create({
    data: {
      partnerId,
      referralCode: `module96_${uniqueSuffix()}`,
      conversionEventId: randomUUID(),
      platformCommissionRefId: overrides.platformCommissionRefId ?? randomUUID(),
      platformCommissionAmount,
      attributableCostAmount: 0,
      profitBaseAmount: platformCommissionAmount,
      affiliateRateBps: 1000,
      affiliateAmount,
      status: (overrides.status as never) ?? "APPROVED",
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    },
  });
}
