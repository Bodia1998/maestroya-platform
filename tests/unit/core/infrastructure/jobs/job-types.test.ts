import { describe, expect, it } from "vitest";

import { DEFAULT_BACKOFF, normalizeJobOptions, toActiveJob } from "@/infrastructure/jobs/job-types";
import type { StoredJob } from "@/infrastructure/jobs/job-types";

describe("infrastructure/jobs/job-types", () => {
  describe("normalizeJobOptions", () => {
    it("defaults attempts to 1 (no retry) and backoff to the exponential default", () => {
      expect(normalizeJobOptions(undefined)).toEqual({ attempts: 1, backoff: DEFAULT_BACKOFF });
    });

    it("keeps caller-supplied attempts and backoff", () => {
      const backoff = { type: "fixed" as const, delay: 500 };
      expect(normalizeJobOptions({ attempts: 5, backoff })).toEqual({ attempts: 5, backoff });
    });

    it("rejects attempts below 1", () => {
      expect(() => normalizeJobOptions({ attempts: 0 })).toThrow(RangeError);
    });

    it("rejects non-integer attempts", () => {
      expect(() => normalizeJobOptions({ attempts: 1.5 })).toThrow(RangeError);
    });

    it("rejects a negative delay", () => {
      expect(() => normalizeJobOptions({ delay: -1 })).toThrow(RangeError);
    });

    it("accepts a zero delay", () => {
      expect(() => normalizeJobOptions({ delay: 0 })).not.toThrow();
    });
  });

  describe("toActiveJob", () => {
    it("projects a StoredJob into the ActiveJob shape a processor sees", () => {
      const stored: StoredJob<{ x: number }> = {
        id: "job-1",
        queue: "q",
        name: "do-thing",
        data: { x: 1 },
        opts: { attempts: 3, backoff: DEFAULT_BACKOFF },
        attemptsMade: 2,
        createdAt: 1000,
        processAt: 1000,
      };

      expect(toActiveJob(stored)).toEqual({
        id: "job-1",
        queue: "q",
        name: "do-thing",
        data: { x: 1 },
        attempt: 2,
        maxAttempts: 3,
      });
    });
  });
});
