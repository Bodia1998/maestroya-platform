/**
 * Module 60 — Referral & Marketing Attribution Platform: `MarketingSourceValue`
 * — the closed set of channels a visit/attribution can be resolved to — and
 * the pure resolution function `resolveMarketingSource`. No Prisma/HTTP
 * import here (same "domain layer is provider/framework-agnostic"
 * convention `professional-verification-rules.ts` documents) — a caller
 * (`TrackVisitUseCase`) is responsible for extracting `utmSource`/
 * `referralCode`/`refererHost` from the actual HTTP request first.
 */
export const MARKETING_SOURCE_VALUES = [
  "TELEGRAM",
  "INSTAGRAM",
  "TIKTOK",
  "FACEBOOK",
  "GOOGLE_ADS",
  "YOUTUBE",
  "ORGANIC_SEARCH",
  "DIRECT",
  "REFERRAL",
  "EMAIL",
  "UNKNOWN",
] as const;
export type MarketingSourceValue = (typeof MARKETING_SOURCE_VALUES)[number];

/** Known `utm_source` values (case-insensitive) mapped straight to a
 *  channel — covers the marketing channels this module was built to track.
 *  An `utm_source` present but absent from this map still counts as
 *  "explicit" (see resolution precedence below) and resolves to `UNKNOWN`
 *  rather than falling through to referral-code/referrer inference, since
 *  a marketer who bothered to tag a link with a source clearly did not
 *  intend for it to be inferred from something else. */
const UTM_SOURCE_MAP: Record<string, MarketingSourceValue> = {
  telegram: "TELEGRAM",
  instagram: "INSTAGRAM",
  tiktok: "TIKTOK",
  facebook: "FACEBOOK",
  fb: "FACEBOOK",
  google_ads: "GOOGLE_ADS",
  "google-ads": "GOOGLE_ADS",
  googleads: "GOOGLE_ADS",
  adwords: "GOOGLE_ADS",
  youtube: "YOUTUBE",
  email: "EMAIL",
  newsletter: "EMAIL",
};

/** Hostname substrings of the search engines this module recognizes for
 *  best-effort organic-search attribution when no `utm_source`/referral
 *  code is present. Deliberately a coarse keyword match, not an exhaustive
 *  list — this is a "better than DIRECT/UNKNOWN" signal for reporting, not
 *  a precise classifier. */
const SEARCH_ENGINE_HOST_KEYWORDS = ["google.", "bing.", "yahoo.", "duckduckgo.", "yandex.", "baidu."];

export interface ResolveMarketingSourceInput {
  utmSource?: string | null;
  referralCode?: string | null;
  /** Hostname parsed from the HTTP `Referer` header (e.g.
   *  `"www.google.com"`) — never the full URL (which may carry a search
   *  query or other visitor-identifying data this module never persists). */
  refererHost?: string | null;
}

/**
 * Resolution precedence (checked in this exact order, first match wins):
 *  1. An explicit, recognized `utm_source` — the marketer's own explicit
 *     label always wins over anything this module could infer.
 *  2. An explicit but *unrecognized* `utm_source` — still explicit intent,
 *     so it resolves to `UNKNOWN` rather than falling through to
 *     referral-code/referrer inference (see `UTM_SOURCE_MAP`'s doc
 *     comment).
 *  3. A `referralCode` present with no `utm_source` at all implies
 *     `REFERRAL` — e.g. a professional's own `?r=maria_valencia` link with
 *     no UTM tagging.
 *  4. A referrer hostname matching a known search engine implies
 *     `ORGANIC_SEARCH`.
 *  5. No referrer at all (and none of the above) implies `DIRECT` — the
 *     visitor typed the URL or used a bookmark/saved link.
 *  6. Anything else (a referrer present but not a recognized search
 *     engine, e.g. an arbitrary external site linking in without UTM tags)
 *     resolves to `UNKNOWN`.
 */
export function resolveMarketingSource(input: ResolveMarketingSourceInput): MarketingSourceValue {
  const utmSource = input.utmSource?.trim().toLowerCase() || null;
  if (utmSource) {
    return UTM_SOURCE_MAP[utmSource] ?? "UNKNOWN";
  }

  if (input.referralCode) {
    return "REFERRAL";
  }

  const host = input.refererHost?.trim().toLowerCase() || null;
  if (!host) {
    return "DIRECT";
  }

  if (SEARCH_ENGINE_HOST_KEYWORDS.some((keyword) => host.includes(keyword))) {
    return "ORGANIC_SEARCH";
  }

  return "UNKNOWN";
}
