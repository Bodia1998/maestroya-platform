import { z } from "zod";

import { REFERRAL_CODE_MAX_LENGTH, REFERRAL_CODE_MIN_LENGTH } from "@/domain/services/referral-code-rules";
import { CONVERSION_TYPE_VALUES } from "@/domain/repositories/conversion-event-repository";

/**
 * Module 60 — Referral & Marketing Attribution Platform. Same convention as
 * verification.dto.ts: one schema shared by the client-facing tracking
 * endpoint/Server Action boundary and the composed use case it calls.
 */

const referralCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(REFERRAL_CODE_MIN_LENGTH)
  .max(REFERRAL_CODE_MAX_LENGTH)
  .regex(/^[a-z0-9_]+$/, "Referral code may only contain lowercase letters, digits, and underscores.");

export const createReferralCodeSchema = z.object({
  code: referralCodeSchema,
  ownerUserId: z.string().uuid().optional(),
  label: z.string().trim().max(120).optional(),
});
export type CreateReferralCodeInput = z.infer<typeof createReferralCodeSchema>;

/**
 * `visitorId` is the opaque, client-generated/cookie-stored identifier the
 * tracking endpoint expects on every call — see docs/MODULE_60's "Visitor
 * identity" section. Every UTM field is optional/nullable — a visit may
 * arrive with none of them (a bare `landingPage` only, still worth
 * recording as a DIRECT/UNKNOWN visit).
 */
export const trackVisitSchema = z.object({
  visitorId: z.string().trim().min(1).max(100),
  referralCode: referralCodeSchema.optional(),
  utmSource: z.string().trim().max(191).optional(),
  utmMedium: z.string().trim().max(191).optional(),
  utmCampaign: z.string().trim().max(191).optional(),
  utmContent: z.string().trim().max(191).optional(),
  utmTerm: z.string().trim().max(191).optional(),
  landingPage: z.string().trim().min(1).max(500),
  refererHost: z.string().trim().max(255).optional(),
});
export type TrackVisitInput = z.infer<typeof trackVisitSchema>;

export const recordConversionSchema = z.object({
  visitorId: z.string().trim().min(1).max(100),
  type: z.enum(CONVERSION_TYPE_VALUES),
  referenceId: z.string().trim().max(191).optional(),
  revenueAmount: z.number().nonnegative().optional(),
  occurredAt: z.coerce.date().optional(),
});
export type RecordConversionInput = z.infer<typeof recordConversionSchema>;
