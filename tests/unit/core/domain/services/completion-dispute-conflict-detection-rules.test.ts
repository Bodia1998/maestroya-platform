import { describe, expect, it } from "vitest";

import {
  DISPUTE_AFTER_COMPLETION_SUSPICIOUS_WINDOW_MINUTES,
  detectCompletionDuringActiveDispute,
  detectDisputeShortlyAfterCompletion,
} from "@/domain/services/completion-dispute-conflict-detection-rules";

const JOB_ID = "job-1";
const DISPUTE_ID = "dispute-1";
const PROFESSIONAL_ID = "professional-1";

function minutesAfter(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

describe("Module 67 — detectDisputeShortlyAfterCompletion", () => {
  it("returns null for a dispute opened well after a reasonable review period", () => {
    const jobCompletedAt = new Date("2026-08-15T12:00:00.000Z");
    const disputeCreatedAt = minutesAfter(jobCompletedAt, 60 * 24); // 1 day later

    expect(
      detectDisputeShortlyAfterCompletion({
        jobId: JOB_ID,
        disputeId: DISPUTE_ID,
        raisedByUserId: "user-1",
        professionalProfileId: PROFESSIONAL_ID,
        jobCompletedAt,
        disputeCreatedAt,
      }),
    ).toBeNull();
  });

  it("flags a dispute opened immediately after completion", () => {
    const jobCompletedAt = new Date("2026-08-15T12:00:00.000Z");
    const disputeCreatedAt = minutesAfter(jobCompletedAt, 1);

    const finding = detectDisputeShortlyAfterCompletion({
      jobId: JOB_ID,
      disputeId: DISPUTE_ID,
      raisedByUserId: "user-1",
      professionalProfileId: PROFESSIONAL_ID,
      jobCompletedAt,
      disputeCreatedAt,
    });

    expect(finding).not.toBeNull();
    expect(finding?.reason).toBe("DISPUTE_IMMEDIATELY_AFTER_COMPLETION");
    expect(finding?.jobId).toBe(JOB_ID);
    expect(finding?.disputeId).toBe(DISPUTE_ID);
  });

  it("returns null when the dispute predates completion (not this scenario)", () => {
    const jobCompletedAt = new Date("2026-08-15T12:00:00.000Z");
    const disputeCreatedAt = minutesAfter(jobCompletedAt, -30);

    expect(
      detectDisputeShortlyAfterCompletion({
        jobId: JOB_ID,
        disputeId: DISPUTE_ID,
        raisedByUserId: "user-1",
        professionalProfileId: PROFESSIONAL_ID,
        jobCompletedAt,
        disputeCreatedAt,
      }),
    ).toBeNull();
  });

  it("boundary — exactly at the threshold is NOT flagged", () => {
    const jobCompletedAt = new Date("2026-08-15T12:00:00.000Z");
    const disputeCreatedAt = minutesAfter(jobCompletedAt, DISPUTE_AFTER_COMPLETION_SUSPICIOUS_WINDOW_MINUTES);

    expect(
      detectDisputeShortlyAfterCompletion({
        jobId: JOB_ID,
        disputeId: DISPUTE_ID,
        raisedByUserId: "user-1",
        professionalProfileId: PROFESSIONAL_ID,
        jobCompletedAt,
        disputeCreatedAt,
      }),
    ).toBeNull();
  });

  it("boundary — one second below the threshold IS flagged", () => {
    const jobCompletedAt = new Date("2026-08-15T12:00:00.000Z");
    const disputeCreatedAt = new Date(
      minutesAfter(jobCompletedAt, DISPUTE_AFTER_COMPLETION_SUSPICIOUS_WINDOW_MINUTES).getTime() - 1000,
    );

    const finding = detectDisputeShortlyAfterCompletion({
      jobId: JOB_ID,
      disputeId: DISPUTE_ID,
      raisedByUserId: "user-1",
      professionalProfileId: PROFESSIONAL_ID,
      jobCompletedAt,
      disputeCreatedAt,
    });

    expect(finding).not.toBeNull();
  });

  it("is idempotent as a pure function — identical input yields identical output", () => {
    const jobCompletedAt = new Date("2026-08-15T12:00:00.000Z");
    const disputeCreatedAt = minutesAfter(jobCompletedAt, 2);
    const input = {
      jobId: JOB_ID,
      disputeId: DISPUTE_ID,
      raisedByUserId: "user-1",
      professionalProfileId: PROFESSIONAL_ID,
      jobCompletedAt,
      disputeCreatedAt,
    };

    expect(detectDisputeShortlyAfterCompletion(input)).toEqual(detectDisputeShortlyAfterCompletion(input));
  });
});

describe("Module 67 — detectCompletionDuringActiveDispute", () => {
  it("returns null when there is no open dispute on the job", () => {
    expect(
      detectCompletionDuringActiveDispute({
        jobId: JOB_ID,
        professionalProfileId: PROFESSIONAL_ID,
        completedByUserId: "user-1",
        completedAt: new Date(),
        openDisputeIds: [],
      }),
    ).toBeNull();
  });

  it("flags completion while a dispute is still open on the job", () => {
    const finding = detectCompletionDuringActiveDispute({
      jobId: JOB_ID,
      professionalProfileId: PROFESSIONAL_ID,
      completedByUserId: "user-1",
      completedAt: new Date(),
      openDisputeIds: [DISPUTE_ID],
    });

    expect(finding).not.toBeNull();
    expect(finding?.reason).toBe("COMPLETION_DURING_ACTIVE_DISPUTE");
    expect(finding?.disputeId).toBe(DISPUTE_ID);
    expect(finding?.professionalProfileId).toBe(PROFESSIONAL_ID);
  });

  it("flags and reports every open dispute id in the detail text when multiple are open", () => {
    const finding = detectCompletionDuringActiveDispute({
      jobId: JOB_ID,
      professionalProfileId: PROFESSIONAL_ID,
      completedByUserId: "user-1",
      completedAt: new Date(),
      openDisputeIds: ["dispute-1", "dispute-2"],
    });

    expect(finding?.detail).toContain("dispute-1");
    expect(finding?.detail).toContain("dispute-2");
  });

  it("handles a null professionalProfileId (company job) without throwing", () => {
    const finding = detectCompletionDuringActiveDispute({
      jobId: JOB_ID,
      professionalProfileId: null,
      completedByUserId: "user-1",
      completedAt: new Date(),
      openDisputeIds: [DISPUTE_ID],
    });

    expect(finding?.professionalProfileId).toBeNull();
  });
});
