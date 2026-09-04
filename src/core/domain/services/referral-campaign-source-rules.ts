/**
 * Module 96 — Referral & Affiliate Production Wiring: the closed set of
 * campaign-source labels a partner may tag a referral link with, shown on
 * the partner dashboard. Display-only metadata — no integration with any
 * actual channel (no OAuth, no posting API, nothing). Deliberately a
 * separate, smaller list from Module 60's `MARKETING_SOURCE_VALUES`
 * (which classifies inbound traffic across the *whole platform*, including
 * channels a partner never originates, like GOOGLE_ADS or ORGANIC_SEARCH):
 * this one is only ever a partner's own free choice of "what I'm about to
 * share this link on."
 */
export const REFERRAL_CAMPAIGN_SOURCE_VALUES = ["TELEGRAM", "INSTAGRAM", "TIKTOK", "YOUTUBE", "BLOG", "WEBSITE"] as const;
export type ReferralCampaignSourceValue = (typeof REFERRAL_CAMPAIGN_SOURCE_VALUES)[number];

export function isValidReferralCampaignSource(value: string): value is ReferralCampaignSourceValue {
  return (REFERRAL_CAMPAIGN_SOURCE_VALUES as readonly string[]).includes(value);
}
