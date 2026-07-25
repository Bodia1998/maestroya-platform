import { describe, expect, it } from "vitest";

import { computeBayesianRating } from "@/domain/services/bayesian-rating";

describe("computeBayesianRating", () => {
  it("returns the prior mean when there are zero reviews", () => {
    expect(computeBayesianRating({ averageRating: null, reviewCount: 0 })).toBe(3.5);
  });

  it("pulls a single 5-star review strongly toward the prior mean", () => {
    const rating = computeBayesianRating({ averageRating: 5, reviewCount: 1 });
    // (10*3.5 + 1*5) / 11 = 3.6363...
    expect(rating).toBeCloseTo(3.636, 3);
    expect(rating).toBeLessThan(4);
  });

  it("trusts a high volume of consistent reviews close to their raw average", () => {
    const rating = computeBayesianRating({ averageRating: 4.8, reviewCount: 500 });
    expect(rating).toBeGreaterThan(4.75);
  });

  it("a professional with one 5-star review never outranks one with hundreds of 4.7-star reviews", () => {
    const oneReview = computeBayesianRating({ averageRating: 5, reviewCount: 1 });
    const manyReviews = computeBayesianRating({ averageRating: 4.7, reviewCount: 300 });
    expect(manyReviews).toBeGreaterThan(oneReview);
  });

  it("respects custom prior mean/weight", () => {
    const rating = computeBayesianRating({ averageRating: 5, reviewCount: 5, priorMean: 4, priorWeight: 5 });
    // (5*4 + 5*5) / 10 = 4.5
    expect(rating).toBeCloseTo(4.5, 5);
  });

  it("is deterministic for identical inputs", () => {
    const a = computeBayesianRating({ averageRating: 4.2, reviewCount: 17 });
    const b = computeBayesianRating({ averageRating: 4.2, reviewCount: 17 });
    expect(a).toBe(b);
  });

  it("clamps negative review counts to zero reviews", () => {
    expect(computeBayesianRating({ averageRating: 5, reviewCount: -3 })).toBe(3.5);
  });
});
