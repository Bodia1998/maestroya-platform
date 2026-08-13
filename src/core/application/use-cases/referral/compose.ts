import { PrismaConversionEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversion-event-repository";
import { PrismaMarketingAttributionRepository } from "@/infrastructure/database/prisma/repositories/prisma-marketing-attribution-repository";
import { PrismaReferralCodeRepository } from "@/infrastructure/database/prisma/repositories/prisma-referral-code-repository";
import { PrismaReferralVisitRepository } from "@/infrastructure/database/prisma/repositories/prisma-referral-visit-repository";
import { env } from "@/infrastructure/config/env";
import { CreateReferralCodeUseCase } from "@/application/use-cases/referral/create-referral-code.use-case";
import { GetReferralStatisticsUseCase } from "@/application/use-cases/referral/get-referral-statistics.use-case";
import { LinkRegistrationAttributionUseCase } from "@/application/use-cases/referral/link-registration-attribution.use-case";
import { RecordConversionUseCase } from "@/application/use-cases/referral/record-conversion.use-case";
import { TrackVisitUseCase } from "@/application/use-cases/referral/track-visit.use-case";

/**
 * Module 60 — Referral & Marketing Attribution Platform: composition root
 * — wires the Prisma implementations to every referral/attribution use
 * case. Same "one shared repository instance, one factory function per use
 * case" convention as verification/compose.ts.
 *
 * `AUTH_SECRET` is reused as `TrackVisitUseCase`'s IP-hashing pepper — the
 * same value `getClientIpHash()` (infrastructure/auth/request-context.ts)
 * already passes to `hashIp` for Module 24's own rate-limiting/security-
 * event hashing, so a raw IP hashed by either code path produces the same
 * hash for the same IP (useful for correlating a referral visit with a
 * security event without ever storing a second raw IP anywhere).
 */
const referralCodes = new PrismaReferralCodeRepository();
const referralVisits = new PrismaReferralVisitRepository();
const marketingAttributions = new PrismaMarketingAttributionRepository();
const conversionEvents = new PrismaConversionEventRepository();

export function makeCreateReferralCodeUseCase() {
  return new CreateReferralCodeUseCase(referralCodes);
}

export function makeTrackVisitUseCase() {
  return new TrackVisitUseCase(referralVisits, marketingAttributions, env.AUTH_SECRET);
}

export function makeRecordConversionUseCase() {
  return new RecordConversionUseCase(conversionEvents, marketingAttributions);
}

export function makeGetReferralStatisticsUseCase() {
  return new GetReferralStatisticsUseCase(referralVisits, marketingAttributions, conversionEvents);
}

export function makeLinkRegistrationAttributionUseCase() {
  return new LinkRegistrationAttributionUseCase(marketingAttributions);
}
