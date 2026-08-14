import { describe, expect, it } from "vitest";

import { detectReviewerBurst, detectReviewRing, REVIEWER_BURST_THRESHOLD } from "@/domain/services/fake-review-detection-rules";
import { detectSpamActivity } from "@/domain/services/spam-detection-rules";
import { detectExcessiveCancellations, detectGhostCustomer } from "@/domain/services/booking-abuse-detection-rules";
import { detectChargebackAbuse, detectRefundAbuse } from "@/domain/services/payment-abuse-detection-rules";
import { detectIdentityRisk } from "@/domain/services/identity-risk-rules";

describe("Module 65 — fake-review-detection-rules", () => {
  it("flags a reviewer burst at the threshold", () => {
    const finding = detectReviewerBurst({
      reviewerUserId: "u1",
      reviewsInWindow: REVIEWER_BURST_THRESHOLD,
      reviewsWithoutCompletedJob: 0,
    });
    expect(finding?.reason).toBe("REVIEWER_BURST");
  });

  it("flags a review ring at the threshold", () => {
    const finding = detectReviewRing({ reviewerUserId: "u1", revieweeUserId: "u2", reciprocalReviewCount: 3 });
    expect(finding?.reason).toBe("REVIEW_RING");
    expect(finding?.involvedUserIds).toEqual(["u1", "u2"]);
  });
});

describe("Module 65 — spam-detection-rules", () => {
  it("returns no findings for ordinary activity", () => {
    expect(
      detectSpamActivity({
        userId: "u1",
        duplicateSubmissionsInWindow: 0,
        distinctRecipientsSameMessageInWindow: 0,
        repeatedQuotesForSameRequest: 0,
        totalActionsInWindow: 5,
      }),
    ).toEqual([]);
  });

  it("flags mass messaging", () => {
    const findings = detectSpamActivity({
      userId: "u1",
      duplicateSubmissionsInWindow: 0,
      distinctRecipientsSameMessageInWindow: 10,
      repeatedQuotesForSameRequest: 0,
      totalActionsInWindow: 10,
    });
    expect(findings.some((f) => f.reason === "MASS_MESSAGING")).toBe(true);
  });
});

describe("Module 65 — booking-abuse-detection-rules", () => {
  it("does not flag a small sample even at a high cancellation rate", () => {
    expect(detectExcessiveCancellations({ userId: "u1", cancellationsInWindow: 2, totalBookingsInWindow: 2 })).toBeNull();
  });

  it("flags an excessive cancellation rate with a large-enough sample", () => {
    const finding = detectExcessiveCancellations({ userId: "u1", cancellationsInWindow: 5, totalBookingsInWindow: 8 });
    expect(finding?.reason).toBe("EXCESSIVE_CANCELLATIONS");
  });

  it("flags a ghost customer", () => {
    const finding = detectGhostCustomer({ userId: "u1", noShowOrUnresponsiveCount: 3, confirmedBookingCount: 5 });
    expect(finding?.reason).toBe("GHOST_CUSTOMER");
  });
});

describe("Module 65 — payment-abuse-detection-rules", () => {
  it("does not flag a small payment sample", () => {
    expect(detectChargebackAbuse({ userId: "u1", chargebacksInWindow: 1, successfulPaymentsInWindow: 3 })).toBeNull();
  });

  it("flags chargeback abuse above the rate threshold with a large-enough sample", () => {
    const finding = detectChargebackAbuse({ userId: "u1", chargebacksInWindow: 3, successfulPaymentsInWindow: 50 });
    expect(finding?.reason).toBe("CHARGEBACK_ABUSE");
  });

  it("flags refund abuse", () => {
    const finding = detectRefundAbuse({ userId: "u1", refundsRequestedInWindow: 4, completedJobsInWindow: 5 });
    expect(finding?.reason).toBe("REFUND_ABUSE");
  });
});

describe("Module 65 — identity-risk-rules", () => {
  it("returns null for a verified professional", () => {
    expect(detectIdentityRisk({ userId: "u1", status: "APPROVED", pastRejectionCount: 5, isExpired: false })).toBeNull();
  });

  it("flags repeated rejections while still unapproved", () => {
    const finding = detectIdentityRisk({ userId: "u1", status: "REJECTED", pastRejectionCount: 2, isExpired: false });
    expect(finding?.reason).toBe("UNVERIFIED_WITH_REPEATED_REJECTIONS");
  });

  it("flags an expired verification with no active rejections", () => {
    const finding = detectIdentityRisk({ userId: "u1", status: "EXPIRED", pastRejectionCount: 0, isExpired: true });
    expect(finding?.reason).toBe("EXPIRED_VERIFICATION_STILL_ACTIVE");
  });
});
