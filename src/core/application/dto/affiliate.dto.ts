import { z } from "zod";

import { PARTNER_TYPE_VALUES } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System. Same convention as
 * `referral.dto.ts`/`verification.dto.ts`: one schema shared by whatever
 * client-facing Server Action/Route Handler boundary is wired up in the
 * future and the composed use case it calls.
 */

export const registerPartnerSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(PARTNER_TYPE_VALUES),
  displayName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(191),
  payoutMethod: z.enum(["MANUAL", "STRIPE"]).optional(),
  payoutDetails: z.record(z.unknown()).optional(),
});
export type RegisterPartnerInput = z.infer<typeof registerPartnerSchema>;

export const rejectPartnerSchema = z.object({
  partnerId: z.string().uuid(),
  adminUserId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export type RejectPartnerInput = z.infer<typeof rejectPartnerSchema>;

export const suspendPartnerSchema = z.object({
  partnerId: z.string().uuid(),
  adminUserId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export type SuspendPartnerInput = z.infer<typeof suspendPartnerSchema>;

export const banPartnerSchema = z.object({
  partnerId: z.string().uuid(),
  adminUserId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export type BanPartnerInput = z.infer<typeof banPartnerSchema>;

export const approvePartnerSchema = z.object({
  partnerId: z.string().uuid(),
  adminUserId: z.string().uuid(),
});
export type ApprovePartnerInput = z.infer<typeof approvePartnerSchema>;

export const generatePartnerReferralLinkSchema = z.object({
  partnerId: z.string().uuid(),
  code: z.string().trim().min(3).max(40),
  label: z.string().trim().max(120).optional(),
});
export type GeneratePartnerReferralLinkInput = z.infer<typeof generatePartnerReferralLinkSchema>;
