import { describe, expect, it } from "vitest";

import {
  MIN_REASONABLE_JOB_DURATION_MINUTES,
  detectPrematureCompletion,
} from "@/domain/services/premature-completion-detection-rules";

const JOB_ID = "job-1";
const PROFESSIONAL_ID = "professional-1";

function minutesAgo(from: Date, minutes: number): Date {
  return new Date(from.getTime() - minutes * 60_000);
}

describe("Module 67 — detectPrematureCompletion", () => {
  it("returns null for a normal-duration completion", () => {
    const completedAt = new Date("2026-08-15T12:00:00.000Z");
    const startedAt = minutesAgo(completedAt, 90); // 1.5 hours — plausible

    expect(
      detectPrematureCompletion({ jobId: JOB_ID, professionalProfileId: PROFESSIONAL_ID, startedAt, completedAt }),
    ).toBeNull();
  });

  it("flags a clearly premature completion", () => {
    const completedAt = new Date("2026-08-15T12:00:00.000Z");
    const startedAt = minutesAgo(completedAt, 1); // 1 minute — implausible

    const finding = detectPrematureCompletion({
      jobId: JOB_ID,
      professionalProfileId: PROFESSIONAL_ID,
      startedAt,
      completedAt,
    });

    expect(finding).not.toBeNull();
    expect(finding?.reason).toBe("PREMATURE_JOB_COMPLETION");
    expect(finding?.jobId).toBe(JOB_ID);
    expect(finding?.professionalProfileId).toBe(PROFESSIONAL_ID);
    expect(finding?.actualDurationMinutes).toBeCloseTo(1, 1);
    expect(finding?.detail).toContain(JOB_ID);
  });

  it("treats a missing startedAt as safe behavior — never flags on missing data", () => {
    const completedAt = new Date("2026-08-15T12:00:00.000Z");

    expect(
      detectPrematureCompletion({
        jobId: JOB_ID,
        professionalProfileId: PROFESSIONAL_ID,
        startedAt: null,
        completedAt,
      }),
    ).toBeNull();
  });

  it("never flags a negative duration (completedAt before startedAt) — defensive only", () => {
    const startedAt = new Date("2026-08-15T12:00:00.000Z");
    const completedAt = minutesAgo(startedAt, 5);

    expect(
      detectPrematureCompletion({
        jobId: JOB_ID,
        professionalProfileId: PROFESSIONAL_ID,
        startedAt,
        completedAt,
      }),
    ).toBeNull();
  });

  it("boundary — exactly at the threshold is NOT flagged (inclusive lower bound on the safe side)", () => {
    const completedAt = new Date("2026-08-15T12:00:00.000Z");
    const startedAt = minutesAgo(completedAt, MIN_REASONABLE_JOB_DURATION_MINUTES);

    expect(
      detectPrematureCompletion({
        jobId: JOB_ID,
        professionalProfileId: PROFESSIONAL_ID,
        startedAt,
        completedAt,
      }),
    ).toBeNull();
  });

  it("boundary — one second below the threshold IS flagged", () => {
    const completedAt = new Date("2026-08-15T12:00:00.000Z");
    const startedAt = new Date(minutesAgo(completedAt, MIN_REASONABLE_JOB_DURATION_MINUTES).getTime() + 1000);

    const finding = detectPrematureCompletion({
      jobId: JOB_ID,
      professionalProfileId: PROFESSIONAL_ID,
      startedAt,
      completedAt,
    });

    expect(finding).not.toBeNull();
  });

  it("boundary — one second above the threshold is NOT flagged", () => {
    const completedAt = new Date("2026-08-15T12:00:00.000Z");
    const startedAt = new Date(minutesAgo(completedAt, MIN_REASONABLE_JOB_DURATION_MINUTES).getTime() - 1000);

    expect(
      detectPrematureCompletion({
        jobId: JOB_ID,
        professionalProfileId: PROFESSIONAL_ID,
        startedAt,
        completedAt,
      }),
    ).toBeNull();
  });

  it("is a pure function — calling it twice with identical input produces an identical finding (no hidden state)", () => {
    const completedAt = new Date("2026-08-15T12:00:00.000Z");
    const startedAt = minutesAgo(completedAt, 2);
    const input = { jobId: JOB_ID, professionalProfileId: PROFESSIONAL_ID, startedAt, completedAt };

    const first = detectPrematureCompletion(input);
    const second = detectPrematureCompletion(input);

    expect(first).toEqual(second);
  });
});
