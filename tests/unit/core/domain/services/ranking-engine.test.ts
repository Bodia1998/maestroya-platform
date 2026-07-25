import { describe, expect, it } from "vitest";

import { RANKING_WEIGHTS, scoreCandidate, type RankingSignals } from "@/domain/services/ranking-engine";

const NOW = new Date("2026-07-25T00:00:00.000Z");

function baseSignals(overrides: Partial<RankingSignals> = {}): RankingSignals {
  return {
    categoryMatch: true,
    textRelevance: 0,
    locationMatch: "NONE",
    isVerified: false,
    averageRating: null,
    reviewCount: 0,
    portfolioItemCount: 0,
    profileCompleteness: 0,
    createdAt: NOW,
    now: NOW,
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("is deterministic for identical inputs", () => {
    const signals = baseSignals({ isVerified: true, averageRating: 4.5, reviewCount: 20 });
    const a = scoreCandidate(signals);
    const b = scoreCandidate(signals);
    expect(a.total).toBe(b.total);
    expect(a.reasons).toEqual(b.reasons);
  });

  it("awards the full category match weight when the category matches", () => {
    const score = scoreCandidate(baseSignals({ categoryMatch: true }));
    expect(score.breakdown.categoryMatchScore).toBe(RANKING_WEIGHTS.CATEGORY_MATCH);
  });

  it("awards zero category match score when it does not match", () => {
    const score = scoreCandidate(baseSignals({ categoryMatch: false }));
    expect(score.breakdown.categoryMatchScore).toBe(0);
  });

  it("gives a verified candidate a strictly higher score than an otherwise identical unverified one", () => {
    const verified = scoreCandidate(baseSignals({ isVerified: true }));
    const unverified = scoreCandidate(baseSignals({ isVerified: false }));
    expect(verified.total).toBeGreaterThan(unverified.total);
    expect(verified.reasons).toContain("Verified professional");
  });

  it("scores EXACT_CITY strictly higher than SAME_PROVINCE, which is strictly higher than NONE", () => {
    const exact = scoreCandidate(baseSignals({ locationMatch: "EXACT_CITY" }));
    const province = scoreCandidate(baseSignals({ locationMatch: "SAME_PROVINCE" }));
    const none = scoreCandidate(baseSignals({ locationMatch: "NONE" }));
    expect(exact.total).toBeGreaterThan(province.total);
    expect(province.total).toBeGreaterThan(none.total);
  });

  it("does not let a single 5-star review outrank hundreds of solid reviews on rating alone", () => {
    const oneReview = scoreCandidate(baseSignals({ averageRating: 5, reviewCount: 1 }));
    const manyReviews = scoreCandidate(baseSignals({ averageRating: 4.7, reviewCount: 300 }));
    expect(manyReviews.breakdown.ratingScore).toBeGreaterThan(oneReview.breakdown.ratingScore);
  });

  it("caps the review volume score at the configured cap (diminishing returns)", () => {
    const at50 = scoreCandidate(baseSignals({ reviewCount: 50, averageRating: 4 }));
    const at5000 = scoreCandidate(baseSignals({ reviewCount: 5000, averageRating: 4 }));
    expect(at50.breakdown.reviewVolumeScore).toBe(at5000.breakdown.reviewVolumeScore);
  });

  it("caps the portfolio score at the configured cap", () => {
    const at5 = scoreCandidate(baseSignals({ portfolioItemCount: 5 }));
    const at500 = scoreCandidate(baseSignals({ portfolioItemCount: 500 }));
    expect(at5.breakdown.portfolioScore).toBe(at500.breakdown.portfolioScore);
    expect(at5.breakdown.portfolioScore).toBe(RANKING_WEIGHTS.PORTFOLIO);
  });

  it("scales text relevance linearly with the [0,1] input", () => {
    const half = scoreCandidate(baseSignals({ textRelevance: 0.5 }));
    const full = scoreCandidate(baseSignals({ textRelevance: 1 }));
    expect(full.breakdown.textRelevanceScore).toBeCloseTo(2 * half.breakdown.textRelevanceScore, 5);
    expect(full.breakdown.textRelevanceScore).toBe(RANKING_WEIGHTS.TEXT_RELEVANCE);
  });

  it("gives full recency score to a brand new candidate and zero once fully decayed", () => {
    const brandNew = scoreCandidate(baseSignals({ createdAt: NOW, now: NOW }));
    const old = scoreCandidate(
      baseSignals({ createdAt: new Date("2020-01-01T00:00:00.000Z"), now: NOW }),
    );
    expect(brandNew.breakdown.recencyScore).toBe(RANKING_WEIGHTS.RECENCY);
    expect(old.breakdown.recencyScore).toBe(0);
  });

  it("never produces a negative total or a NaN", () => {
    const score = scoreCandidate(baseSignals());
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(score.total)).toBe(false);
  });

  it("includes a portfolio reason only when portfolio items exist", () => {
    const noPortfolio = scoreCandidate(baseSignals({ portfolioItemCount: 0 }));
    expect(noPortfolio.reasons.some((r) => r.includes("Portfolio"))).toBe(false);

    const withPortfolio = scoreCandidate(baseSignals({ portfolioItemCount: 3 }));
    expect(withPortfolio.reasons.some((r) => r.includes("Portfolio available (3 items)"))).toBe(true);
  });

  it("never exposes a raw numeric score inside the reasons list", () => {
    const score = scoreCandidate(
      baseSignals({ isVerified: true, averageRating: 4.9, reviewCount: 120, portfolioItemCount: 4 }),
    );
    for (const reason of score.reasons) {
      expect(reason).not.toMatch(/\d+\.\d{2,}/); // no raw decimal scores leak through
    }
  });
});
