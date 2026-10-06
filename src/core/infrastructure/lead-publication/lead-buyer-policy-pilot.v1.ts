import type { LeadBuyerPolicy } from "@/domain/services/lead-publication";

/**
 * Module 133 — LEAD_V1 PILOT buyer policy. DATA ONLY.
 *
 * !! PILOT ASSUMPTION, NOT A BUSINESS DECISION !!
 * The exclusive-vs-shared decision is still open (Module 123 left
 * `Lead.maxBuyers` NULL on purpose). The publication contract needs an
 * explicit value to publish at all, so the pilot uses the smallest valid one:
 * `maxBuyers: 1` (exclusive — at most one successful buyer per Lead). It is the
 * most conservative choice: it can only under-sell, never over-share a
 * customer's contact. It is NOT a validated commercial policy.
 *
 * Changing it requires a NEW `policyVersion` (never edit a released policy in
 * place): the version is stored in every published Lead's snapshot, so each
 * Lead stays attributable to the policy it was published under, and Leads
 * already published keep their original policy.
 */
export const LEAD_BUYER_POLICY_PILOT_V1: LeadBuyerPolicy = Object.freeze({
  policyVersion: "lead-buyer-policy-pilot-v1",
  maxBuyers: 1,
});
