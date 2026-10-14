import "server-only";

import { getTranslations } from "next-intl/server";

import { adminActionFailure, type AdminActionErrorKey } from "../../_lib/action-errors";
import { LeadAbuseControlRejectedError } from "@/domain/services/lead-abuse-controls";
import { LeadAdminConsoleRejectedError } from "@/domain/services/lead-admin-console";
import { LeadEstimateOutcomeRejectedError } from "@/domain/services/lead-estimate-outcome";
import { LeadFeeDisputeRejectedError } from "@/domain/services/lead-fee-dispute";
import { LeadPricingReviewRejectedError } from "@/domain/services/lead-pricing-review";
import { LeadQualityClaimRejectedError } from "@/domain/services/lead-quality-claim";

/**
 * Module 157 — maps the CLOSED reason codes of the console's own errors and of the M154 / M155 / M156 rejections to one of four
 * operator-facing messages (`admin.leadOps.errors.*`). The reason code is a closed enum that never carries input, so showing a
 * category of it leaks nothing; anything else (a database error, an unknown error) goes through the shared `adminActionFailure`,
 * which logs it server-side and shows only the localized generic fallback.
 *
 * Authorization failures deliberately collapse to ONE message, whichever layer raised them.
 */
export type LeadOpsErrorKey = "unauthorized" | "invalidInput" | "notFound" | "invalidState";

const NOT_FOUND = new Set(["LEAD_NOT_FOUND", "SUBJECT_NOT_FOUND", "DECISION_NOT_FOUND", "CLAIM_NOT_FOUND", "PURCHASE_NOT_FOUND", "DISPUTE_NOT_FOUND", "REVIEW_NOT_FOUND"]);
const INVALID_STATE = new Set([
  "INVALID_STATE",
  "INVALID_TRANSITION",
  "PURCHASE_NOT_CONFIRMED",
  "DISPUTE_NOT_OPEN",
  // Module 164: pricing review / estimate outcome
  "ALREADY_DECIDED",
  "REVIEW_STALE",
  "VALUE_NOT_PRICEABLE",
  "CONFIGURATION_UNAVAILABLE",
  "LEAD_NOT_PUBLISHED",
  "ALREADY_RECORDED",
]);

export function leadOpsErrorKey(error: unknown): LeadOpsErrorKey | null {
  if (
    !(error instanceof LeadAdminConsoleRejectedError) &&
    !(error instanceof LeadQualityClaimRejectedError) &&
    !(error instanceof LeadFeeDisputeRejectedError) &&
    !(error instanceof LeadAbuseControlRejectedError) &&
    !(error instanceof LeadPricingReviewRejectedError) &&
    !(error instanceof LeadEstimateOutcomeRejectedError)
  ) {
    return null;
  }
  const reason: string = error.reason;
  if (reason === "ACTOR_NOT_AUTHORIZED") return "unauthorized";
  if (reason === "INVALID_INPUT") return "invalidInput";
  if (NOT_FOUND.has(reason)) return "notFound";
  if (INVALID_STATE.has(reason)) return "invalidState";
  return null;
}

export async function leadAdminActionFailure(error: unknown, fallbackKey: AdminActionErrorKey): Promise<{ success: false; error: string }> {
  const key = leadOpsErrorKey(error);
  if (key) {
    const t = await getTranslations("admin.leadOps.errors");
    return { success: false, error: t(key) };
  }
  return adminActionFailure(error, fallbackKey);
}
