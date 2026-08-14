import type { MarketingSourceValue } from "@/domain/services/marketing-source-rules";

/**
 * Module 60 — Referral & Marketing Attribution Platform: repository
 * interface for `ReferralVisit` — one row per tracked, non-duplicate
 * click/visit (see `domain/services/referral-visit-dedup-rules.ts` for the
 * dedup rule `TrackVisitUseCase` applies before ever calling `create`).
 */
export interface ReferralVisitRecord {
  id: string;
  visitorId: string;
  referralCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  marketingSource: MarketingSourceValue;
  /** Keyed hash of the visitor's IP (see `domain/services/security-key.ts`'s
   *  `hashIp`) — never the raw IP. Stored per-visit for abuse/dedup
   *  auxiliary signal only; never used as the attribution join key (see
   *  docs/MODULE_60's "Visitor identity" section for why). */
  ipHash: string | null;
  userAgentTruncated: string | null;
  landingPage: string;
  createdAt: Date;
}

export interface CreateReferralVisitData {
  visitorId: string;
  referralCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  marketingSource: MarketingSourceValue;
  ipHash: string | null;
  userAgentTruncated: string | null;
  landingPage: string;
}

export interface TopReferralCodeStat {
  referralCode: string;
  visits: number;
}

export interface TopCampaignStat {
  campaign: string;
  visits: number;
}

export interface ReferralVisitRepository {
  create(data: CreateReferralVisitData): Promise<ReferralVisitRecord>;

  /** Every visit for `visitorId` at or after `since` — feeds
   *  `isDuplicateVisit`'s dedup window check. Ordered newest-first is not
   *  required; the pure dedup function scans the whole set. */
  findRecentByVisitor(visitorId: string, since: Date): Promise<ReferralVisitRecord[]>;

  countAll(): Promise<number>;

  /** Referral codes ranked by visit count, descending, capped at `limit`.
   *  Visits with a null `referralCode` are excluded. */
  topReferralCodesByVisits(limit: number): Promise<TopReferralCodeStat[]>;

  /** Campaign grouping keys (see `utmCampaign`, falling back to
   *  `referralCode` when `utmCampaign` is null — the same grouping key
   *  `TouchInput.campaign` uses) ranked by visit count, descending, capped
   *  at `limit`. */
  topCampaignsByVisits(limit: number): Promise<TopCampaignStat[]>;

  /**
   * Module 61 — Affiliate & Partner System: every visit whose
   * `referralCode` is one of `codes` — the read `GetPartnerDashboardStatisticsUseCase`
   * uses to scope "clicks/visits" and per-partner top-campaign/top-code
   * breakdowns to exactly one partner's own referral codes, without this
   * module needing a `partnerId`/`ownerUserId` column on `ReferralVisit`
   * itself (partner scoping is derived entirely from `ReferralCode.code`
   * membership, reusing Module 60's existing shape as-is). Returns `[]` for
   * an empty `codes` array rather than every visit.
   */
  listByReferralCodes(codes: string[]): Promise<ReferralVisitRecord[]>;
}
