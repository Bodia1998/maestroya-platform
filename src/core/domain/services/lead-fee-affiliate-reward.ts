import { detectSelfReferral } from "@/domain/services/affiliate-fraud-rules";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { LEAD_FEE_PAYMENT_SUCCEEDED } from "@/domain/services/lead-fee-revenue-ledger";

/**
 * Module 162 — Affiliate Lead-Fee Reward Model: pure, policy-independent domain foundation.
 *
 * ## Status: FAIL-CLOSED. No reward policy is approved.
 * The roadmap blocks M162 on decision D18 (reward rate and basis, who is referred, hold period,
 * payout minimum, tax treatment). Only a *recommended default* is written down; it is not an approved
 * decision and is NOT encoded here. `ACTIVE_LEAD_FEE_REWARD_POLICY_CONFIG` is therefore `null`, and
 * every function that needs a policy refuses to produce a reward without one. Nothing in this file
 * contains a percentage, a hold period, a payout threshold or an attribution window.
 *
 * ## What this file is
 * - the shape an approved policy must have (`LeadFeeRewardPolicy`) and a strict parser that refuses
 *   anything incomplete (`resolveLeadFeeRewardPolicy`);
 * - the eligibility rules (`evaluateLeadFeeRewardEligibility`): a reward may only be anchored to a
 *   persisted M149 `LEAD_FEE_PAYMENT_SUCCEEDED` ledger entry of a CONFIRMED purchase, in EUR, with a valid,
 *   non-self attribution to an APPROVED partner and an active code;
 * - exact-decimal arithmetic (bigint, no floating point) for the reward and for a full reversal.
 *
 * ## What this file is not
 * It performs no I/O, creates no rows, subscribes to no event, moves no money and enables no payout.
 * The reward basis is the lead-fee ledger entry's NET fee only — never the job value estimate, the
 * customer's payment to the professional, the IVA, or the VAT-inclusive total.
 *
 * ## Reversal
 * Refund policy is untouched (M153: full refund). A reversal reverses what remains of the reward in
 * full; partial reversal does not exist because partial lead-fee refunds do not exist. Settled history
 * is never rewritten: a reversal is a new amount, computed against the already-reversed total.
 */

export const LEAD_FEE_REWARD_CURRENCY = "EUR";
const MONEY_SCALE = 2;
const BPS_DENOMINATOR = 10_000n;

/** Which party's referral earns the reward. D18 decides; neither is assumed. */
export const LEAD_FEE_REWARD_REFERRED_PARTIES = ["PROFESSIONAL", "CUSTOMER"] as const;
export type LeadFeeRewardReferredParty = (typeof LEAD_FEE_REWARD_REFERRED_PARTIES)[number];

/**
 * Only NET_LEAD_FEE (LeadFeeLedgerEntry.netFeeAmount) is supported. "Net of Stripe fee" (the roadmap's
 * recommended default) is NOT supported: no Stripe fee is persisted for lead-fee payments, so it cannot
 * be computed from stored data. It stays unsupported until a fee is captured.
 */
export const LEAD_FEE_REWARD_BASES = ["NET_LEAD_FEE"] as const;
export type LeadFeeRewardBasis = (typeof LEAD_FEE_REWARD_BASES)[number];

export const LEAD_FEE_REWARD_ROUNDINGS = ["HALF_UP", "DOWN"] as const;
export type LeadFeeRewardRounding = (typeof LEAD_FEE_REWARD_ROUNDINGS)[number];

/** A fully specified, explicitly approved policy. Every field is mandatory; nothing is defaulted. */
export interface LeadFeeRewardPolicy {
  /** Immutable version label, stored with every reward so its calculation stays explainable. */
  version: string;
  /** Reference to the recorded owner/legal approval (D18). Free text, but must be non-empty. */
  approvalReference: string;
  referredParty: LeadFeeRewardReferredParty;
  basis: LeadFeeRewardBasis;
  /** Integer basis points, 1..10000. */
  rateBps: number;
  rounding: LeadFeeRewardRounding;
  /** Whole days between lead-fee confirmation and the reward becoming payout-eligible. May be 0 only if approved as 0. */
  holdDays: number;
}

/**
 * The only place a shipped policy could ever be activated. Deliberately `null`: activating a reward
 * policy is a business/legal decision (D18) and must be a reviewed change to this constant, with the
 * approval reference, not a side effect of any other change.
 */
export const ACTIVE_LEAD_FEE_REWARD_POLICY_CONFIG: unknown = null;

export type LeadFeeRewardPolicyResolution =
  | { status: "APPROVED"; policy: LeadFeeRewardPolicy }
  | { status: "UNAPPROVED"; reason: LeadFeeRewardPolicyRejection };

export type LeadFeeRewardPolicyRejection =
  | "POLICY_ABSENT"
  | "POLICY_MALFORMED"
  | "APPROVAL_REFERENCE_MISSING"
  | "REFERRED_PARTY_UNSUPPORTED"
  | "BASIS_UNSUPPORTED"
  | "RATE_INVALID"
  | "ROUNDING_UNSUPPORTED"
  | "HOLD_INVALID";

/** Strict, fail-closed parser. Any missing/invalid field => UNAPPROVED. Never fills in a default. */
export function resolveLeadFeeRewardPolicy(raw: unknown): LeadFeeRewardPolicyResolution {
  if (raw === null || raw === undefined) return { status: "UNAPPROVED", reason: "POLICY_ABSENT" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { status: "UNAPPROVED", reason: "POLICY_MALFORMED" };
  const p = raw as Record<string, unknown>;

  if (typeof p.version !== "string" || p.version.trim() === "") return { status: "UNAPPROVED", reason: "POLICY_MALFORMED" };
  if (typeof p.approvalReference !== "string" || p.approvalReference.trim() === "") {
    return { status: "UNAPPROVED", reason: "APPROVAL_REFERENCE_MISSING" };
  }
  if (!(LEAD_FEE_REWARD_REFERRED_PARTIES as readonly unknown[]).includes(p.referredParty)) {
    return { status: "UNAPPROVED", reason: "REFERRED_PARTY_UNSUPPORTED" };
  }
  if (!(LEAD_FEE_REWARD_BASES as readonly unknown[]).includes(p.basis)) return { status: "UNAPPROVED", reason: "BASIS_UNSUPPORTED" };
  if (typeof p.rateBps !== "number" || !Number.isInteger(p.rateBps) || p.rateBps < 1 || p.rateBps > 10_000) {
    return { status: "UNAPPROVED", reason: "RATE_INVALID" };
  }
  if (!(LEAD_FEE_REWARD_ROUNDINGS as readonly unknown[]).includes(p.rounding)) {
    return { status: "UNAPPROVED", reason: "ROUNDING_UNSUPPORTED" };
  }
  if (typeof p.holdDays !== "number" || !Number.isInteger(p.holdDays) || p.holdDays < 0 || p.holdDays > 3650) {
    return { status: "UNAPPROVED", reason: "HOLD_INVALID" };
  }

  return {
    status: "APPROVED",
    policy: {
      version: p.version,
      approvalReference: p.approvalReference,
      referredParty: p.referredParty as LeadFeeRewardReferredParty,
      basis: p.basis as LeadFeeRewardBasis,
      rateBps: p.rateBps,
      rounding: p.rounding as LeadFeeRewardRounding,
      holdDays: p.holdDays,
    },
  };
}

/** The resolution of the shipped configuration. Always UNAPPROVED until D18 is closed. */
export function getActiveLeadFeeRewardPolicy(): LeadFeeRewardPolicyResolution {
  return resolveLeadFeeRewardPolicy(ACTIVE_LEAD_FEE_REWARD_POLICY_CONFIG);
}

// ---------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------

/** The persisted M149 ledger entry the reward is anchored to (a subset of LeadFeeRevenueLedgerEntryRecord). */
export interface LeadFeeRewardSourceEntry {
  id: string;
  entryType: string;
  leadPurchaseId: string;
  netFeeAmount: string;
  currency: string;
  paymentConfirmedAt: Date;
}

/** Attribution already resolved by the existing M60/M61 components (no new attribution logic here). */
export interface LeadFeeRewardAttribution {
  partnerId: string;
  /** The partner's own user id (the ReferralCode owner). */
  partnerUserId: string;
  partnerApproved: boolean;
  referralCodeActive: boolean;
  /** The user that the attribution subject resolves to under the policy's referredParty. */
  referredUserId: string | null;
  referredParty: LeadFeeRewardReferredParty;
}

export interface LeadFeeRewardEligibilityInput {
  policy: LeadFeeRewardPolicyResolution;
  /** Null when the purchase has no persisted ledger entry. */
  sourceEntry: LeadFeeRewardSourceEntry | null;
  /** Current LeadPurchase.status. */
  purchaseStatus: string;
  /** Null when no attribution exists. */
  attribution: LeadFeeRewardAttribution | null;
}

export type LeadFeeRewardIneligibleReason =
  | "POLICY_UNAPPROVED"
  | "SOURCE_ENTRY_MISSING"
  | "SOURCE_ENTRY_UNSUPPORTED_TYPE"
  | "UNSUPPORTED_CURRENCY"
  | "PURCHASE_NOT_CONFIRMED"
  | "NO_ATTRIBUTION"
  | "ATTRIBUTION_SUBJECT_MISMATCH"
  | "ATTRIBUTION_INCOMPLETE"
  | "SELF_REFERRAL"
  | "PARTNER_NOT_APPROVED"
  | "REFERRAL_CODE_INACTIVE"
  | "BASIS_INVALID"
  | "REWARD_ZERO";

export type LeadFeeRewardEligibility =
  | { eligible: true; policy: LeadFeeRewardPolicy; sourceEntry: LeadFeeRewardSourceEntry; attribution: LeadFeeRewardAttribution }
  | { eligible: false; reason: LeadFeeRewardIneligibleReason; policyRejection?: LeadFeeRewardPolicyRejection };

/**
 * Evaluates, in a fixed order, whether a reward may be created. First failing rule wins; the order
 * puts the policy first so that without an approved policy nothing else is even looked at.
 * Idempotency (at most one reward per ledger entry) is a persistence concern and is NOT decided here.
 */
export function evaluateLeadFeeRewardEligibility(input: LeadFeeRewardEligibilityInput): LeadFeeRewardEligibility {
  if (input.policy.status !== "APPROVED") {
    return { eligible: false, reason: "POLICY_UNAPPROVED", policyRejection: input.policy.reason };
  }
  const policy = input.policy.policy;

  const entry = input.sourceEntry;
  if (!entry) return { eligible: false, reason: "SOURCE_ENTRY_MISSING" };
  if (entry.entryType !== LEAD_FEE_PAYMENT_SUCCEEDED) return { eligible: false, reason: "SOURCE_ENTRY_UNSUPPORTED_TYPE" };
  if (entry.currency !== LEAD_FEE_REWARD_CURRENCY) return { eligible: false, reason: "UNSUPPORTED_CURRENCY" };
  if (input.purchaseStatus !== "CONFIRMED") return { eligible: false, reason: "PURCHASE_NOT_CONFIRMED" };

  const net = parseScaledDecimal(entry.netFeeAmount, MONEY_SCALE);
  if (net === null) return { eligible: false, reason: "BASIS_INVALID" };

  const attribution = input.attribution;
  if (!attribution) return { eligible: false, reason: "NO_ATTRIBUTION" };
  if (attribution.referredParty !== policy.referredParty) return { eligible: false, reason: "ATTRIBUTION_SUBJECT_MISMATCH" };
  if (!attribution.referredUserId || !attribution.partnerId || !attribution.partnerUserId) {
    return { eligible: false, reason: "ATTRIBUTION_INCOMPLETE" };
  }

  // Reuses the existing M61 self-referral rule unchanged.
  const selfReferral = detectSelfReferral(attribution.partnerUserId, [
    { referredUserId: attribution.referredUserId, visitorId: "", ipHash: null, userAgentTruncated: null, occurredAt: entry.paymentConfirmedAt },
  ]);
  if (selfReferral.length > 0) return { eligible: false, reason: "SELF_REFERRAL" };

  if (!attribution.partnerApproved) return { eligible: false, reason: "PARTNER_NOT_APPROVED" };
  if (!attribution.referralCodeActive) return { eligible: false, reason: "REFERRAL_CODE_INACTIVE" };

  if (calculateLeadFeeRewardAmount(entry.netFeeAmount, policy) === "0.00") return { eligible: false, reason: "REWARD_ZERO" };

  return { eligible: true, policy, sourceEntry: entry, attribution };
}

// ---------------------------------------------------------------------------------------------
// Exact arithmetic
// ---------------------------------------------------------------------------------------------

/** reward = netFee * rateBps / 10000, exact bigint arithmetic, rounded per the policy to cents. */
export function calculateLeadFeeRewardAmount(netFeeAmount: string, policy: Pick<LeadFeeRewardPolicy, "rateBps" | "rounding">): string {
  const net = parseScaledDecimal(netFeeAmount, MONEY_SCALE);
  if (net === null) throw new Error("netFeeAmount must be a plain non-negative decimal with at most 2 fraction digits.");
  if (!Number.isInteger(policy.rateBps) || policy.rateBps < 1 || policy.rateBps > 10_000) throw new Error("rateBps must be an integer in 1..10000.");
  const numerator = net * BigInt(policy.rateBps);
  let cents = numerator / BPS_DENOMINATOR;
  if (policy.rounding === "HALF_UP" && (numerator % BPS_DENOMINATOR) * 2n >= BPS_DENOMINATOR) cents += 1n;
  return formatScaledDecimal(cents, MONEY_SCALE, MONEY_SCALE);
}

/** The instant a reward becomes payout-eligible: confirmation + policy hold. Pure date arithmetic. */
export function computeLeadFeeRewardReleaseAt(paymentConfirmedAt: Date, holdDays: number): Date {
  return new Date(paymentConfirmedAt.getTime() + holdDays * 24 * 60 * 60 * 1000);
}

/**
 * The amount a (full) reversal removes: whatever has not yet been reversed. Never negative, never more
 * than the original reward, and 0.00 when nothing remains (so a replayed reversal is a no-op).
 * The original reward amount is never rewritten.
 */
export function calculateLeadFeeRewardReversalAmount(rewardAmount: string, alreadyReversedAmount: string): string {
  const reward = parseScaledDecimal(rewardAmount, MONEY_SCALE);
  const reversed = parseScaledDecimal(alreadyReversedAmount, MONEY_SCALE);
  if (reward === null || reversed === null) throw new Error("Amounts must be plain non-negative decimals with at most 2 fraction digits.");
  if (reversed > reward) throw new Error("alreadyReversedAmount exceeds the reward amount.");
  return formatScaledDecimal(reward - reversed, MONEY_SCALE, MONEY_SCALE);
}
