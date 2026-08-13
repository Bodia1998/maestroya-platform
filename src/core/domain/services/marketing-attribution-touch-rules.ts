import type { MarketingSourceValue } from "@/domain/services/marketing-source-rules";

/**
 * Module 60 — Referral & Marketing Attribution Platform: pure "apply one
 * more touch to a visitor's attribution state" rule — the write-once
 * first-touch / always-overwritten last-touch behavior `MarketingAttribution`
 * requires, expressed as a function over plain data so it can be unit
 * tested without a repository and reused identically by
 * `TrackVisitUseCase` whether the visitor already has a row or not (a
 * brand-new visitor's "existing state" is just every field `null`).
 *
 * First-touch immutability: once `firstVisitAt` is non-null, every
 * `first*` field is carried through unchanged by every subsequent call —
 * this is what "assignFirstTouch is write-once" means in practice: there
 * is no code path, anywhere, that overwrites an already-set `first*`
 * field. Last-touch fields are unconditionally replaced on every call.
 */
export interface AttributionTouchState {
  firstSource: MarketingSourceValue | null;
  firstCampaign: string | null;
  firstReferralCode: string | null;
  firstVisitAt: Date | null;
  lastSource: MarketingSourceValue | null;
  lastCampaign: string | null;
  lastReferralCode: string | null;
  lastVisitAt: Date | null;
}

export const EMPTY_ATTRIBUTION_TOUCH_STATE: AttributionTouchState = {
  firstSource: null,
  firstCampaign: null,
  firstReferralCode: null,
  firstVisitAt: null,
  lastSource: null,
  lastCampaign: null,
  lastReferralCode: null,
  lastVisitAt: null,
};

export interface TouchInput {
  source: MarketingSourceValue;
  /** `utmCampaign` if present, else the `referralCode` acting as the
   *  campaign grouping key, else `null` — see docs/MODULE_60's "why no
   *  separate MarketingCampaign table" section. */
  campaign: string | null;
  referralCode: string | null;
  visitAt: Date;
}

/** Returns a new state with `touch` applied — never mutates `state`. */
export function applyAttributionTouch(state: AttributionTouchState, touch: TouchInput): AttributionTouchState {
  const isFirstTouchEver = state.firstVisitAt === null;
  return {
    firstSource: isFirstTouchEver ? touch.source : state.firstSource,
    firstCampaign: isFirstTouchEver ? touch.campaign : state.firstCampaign,
    firstReferralCode: isFirstTouchEver ? touch.referralCode : state.firstReferralCode,
    firstVisitAt: isFirstTouchEver ? touch.visitAt : state.firstVisitAt,
    lastSource: touch.source,
    lastCampaign: touch.campaign,
    lastReferralCode: touch.referralCode,
    lastVisitAt: touch.visitAt,
  };
}
