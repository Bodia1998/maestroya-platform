import { assertValidReferralCode } from "@/domain/services/referral-code-rules";
import { resolveMarketingSource } from "@/domain/services/marketing-source-rules";
import { isDuplicateVisit, VISIT_DEDUP_WINDOW_MS, type VisitSignature } from "@/domain/services/referral-visit-dedup-rules";
import {
  applyAttributionTouch,
  EMPTY_ATTRIBUTION_TOUCH_STATE,
} from "@/domain/services/marketing-attribution-touch-rules";
import { hashIp, truncateUserAgent } from "@/domain/services/security-key";
import type { MarketingAttributionRecord, MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { ReferralVisitRecord, ReferralVisitRepository } from "@/domain/repositories/referral-visit-repository";

/**
 * Module 60 — Referral & Marketing Attribution Platform: records one
 * click/visit and folds it into the visitor's `MarketingAttribution`.
 *
 * Orchestration, in order:
 *  1. Normalize/validate `referralCode` if present (format only — a
 *     malformed `?r=` query param is dropped from `utmSource`/referrer
 *     inference the same way a browser extension stripping a query param
 *     would be, rather than failing the whole visit; see
 *     `resolveMarketingSource`'s own precedence rules for why an absent
 *     referral code still resolves to something sensible).
 *  2. Resolve `marketingSource` (pure domain function, no I/O).
 *  3. Hash the caller-supplied raw IP with the shared `hashIp` helper
 *     (Module 24) — never persisted raw.
 *  4. Query `findRecentByVisitor` and apply the pure `isDuplicateVisit`
 *     dedup rule; a duplicate short-circuits without creating a new
 *     `ReferralVisit` row or touching the attribution's last-touch fields
 *     (touching them on every pixel re-fire would make the 60s dedup
 *     window pointless).
 *  5. Otherwise, create the visit row and apply `applyAttributionTouch`
 *     to the visitor's existing attribution state (or the empty state, for
 *     a brand-new visitor), then persist via `upsertTouchState`.
 */
export interface TrackVisitUseCaseInput {
  visitorId: string;
  referralCode?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  landingPage: string;
  /** Hostname parsed from the `Referer` header — see
   *  `ResolveMarketingSourceInput.refererHost`. */
  refererHost?: string | null;
  /** Raw client IP, hashed internally with `ipPepper` before anything is
   *  persisted. Never stored, logged, or returned. */
  rawIp?: string | null;
  userAgent?: string | null;
}

export interface TrackVisitResult {
  visit: ReferralVisitRecord | null;
  attribution: MarketingAttributionRecord;
  deduped: boolean;
}

export class TrackVisitUseCase {
  constructor(
    private readonly visits: ReferralVisitRepository,
    private readonly attributions: MarketingAttributionRepository,
    private readonly ipPepper: string,
  ) {}

  async execute(input: TrackVisitUseCaseInput): Promise<TrackVisitResult> {
    const referralCode = input.referralCode ? this.tryNormalizeReferralCode(input.referralCode) : null;
    const utmSource = input.utmSource?.trim() || null;
    const utmMedium = input.utmMedium?.trim() || null;
    const utmCampaign = input.utmCampaign?.trim() || null;
    const utmContent = input.utmContent?.trim() || null;
    const utmTerm = input.utmTerm?.trim() || null;
    const landingPage = input.landingPage.trim();

    const marketingSource = resolveMarketingSource({
      utmSource,
      referralCode,
      refererHost: input.refererHost ?? null,
    });

    const ipHash = input.rawIp ? hashIp(input.rawIp, this.ipPepper) : null;
    const userAgentTruncated = truncateUserAgent(input.userAgent);

    const now = new Date();
    const since = new Date(now.getTime() - VISIT_DEDUP_WINDOW_MS);
    const recentVisits = await this.visits.findRecentByVisitor(input.visitorId, since);

    const candidate: VisitSignature = {
      visitorId: input.visitorId,
      referralCode,
      utmSource,
      utmMedium,
      utmCampaign,
      landingPage,
      createdAt: now,
    };
    const recentSignatures: VisitSignature[] = recentVisits.map((v) => ({
      visitorId: v.visitorId,
      referralCode: v.referralCode,
      utmSource: v.utmSource,
      utmMedium: v.utmMedium,
      utmCampaign: v.utmCampaign,
      landingPage: v.landingPage,
      createdAt: v.createdAt,
    }));

    if (isDuplicateVisit(candidate, recentSignatures)) {
      const attribution =
        (await this.attributions.findByVisitorId(input.visitorId)) ??
        (await this.attributions.upsertTouchState(input.visitorId, EMPTY_ATTRIBUTION_TOUCH_STATE));
      return { visit: null, attribution, deduped: true };
    }

    const visit = await this.visits.create({
      visitorId: input.visitorId,
      referralCode,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      marketingSource,
      ipHash,
      userAgentTruncated,
      landingPage,
    });

    const existingState = (await this.attributions.findByVisitorId(input.visitorId)) ?? EMPTY_ATTRIBUTION_TOUCH_STATE;
    const nextState = applyAttributionTouch(existingState, {
      source: marketingSource,
      campaign: utmCampaign ?? referralCode ?? null,
      referralCode,
      visitAt: visit.createdAt,
    });
    const attribution = await this.attributions.upsertTouchState(input.visitorId, nextState);

    return { visit, attribution, deduped: false };
  }

  /** A malformed `?r=` is treated as "no referral code" rather than
   *  failing the whole visit — see the class doc comment. */
  private tryNormalizeReferralCode(raw: string): string | null {
    try {
      return assertValidReferralCode(raw);
    } catch {
      return null;
    }
  }
}
