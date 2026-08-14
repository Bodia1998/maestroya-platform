import { z } from "zod";

import { PAYOUT_METHOD_VALUES } from "@/domain/services/professional-onboarding-rules";

/**
 * Module 62 — Professional Onboarding: zod schemas shared by a client form
 * (via @hookform/resolvers/zod) and the Server Action/use case that
 * receives it — same convention as `professional.dto.ts`/`verification.dto.ts`.
 *
 * Deliberately absent from every schema here: raw IP address / User-Agent
 * for the terms-acceptance step — those are resolved server-side from the
 * request (see `infrastructure/auth/request-context.ts`'s
 * `getClientIpHash()`-style helpers), never accepted as client input a
 * caller could spoof.
 */

export const acceptOnboardingTermsSchema = z.object({
  version: z.string().trim().min(1, "A terms version is required.").max(50),
});
export type AcceptOnboardingTermsInput = z.infer<typeof acceptOnboardingTermsSchema>;

export const acceptOnboardingPrivacyPolicySchema = z.object({
  version: z.string().trim().min(1, "A privacy policy version is required.").max(50),
});
export type AcceptOnboardingPrivacyPolicyInput = z.infer<typeof acceptOnboardingPrivacyPolicySchema>;

const accountHolderName = z
  .string()
  .trim()
  .min(2, "Enter the account holder's full name.")
  .max(150);

/**
 * Step 5 — Bank Account: a discriminated union on `method`, one variant per
 * `PayoutMethodValue` (`professional-onboarding-rules.ts`) — the same
 * "provider abstraction" the port/use case follow. Adding a third payout
 * method later means one more branch here, matching one more
 * `PayoutProvider` implementation; no existing branch changes.
 */
export const setPayoutDestinationSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal(PAYOUT_METHOD_VALUES[0]), // "IBAN"
    accountHolderName,
    iban: z
      .string()
      .trim()
      .min(15, "Enter a valid IBAN.")
      .max(34, "Enter a valid IBAN."),
  }),
  z.object({
    method: z.literal(PAYOUT_METHOD_VALUES[1]), // "STRIPE_EXPRESS"
    accountHolderName,
  }),
]);
export type SetPayoutDestinationInput = z.infer<typeof setPayoutDestinationSchema>;
