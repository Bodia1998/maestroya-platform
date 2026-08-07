import { describe, expect, it } from "vitest";

import type { ActiveJob } from "@/infrastructure/jobs/job-types";
import {
  searchIndexJobId,
  searchIndexJobIdempotencyKey,
  type SearchIndexJobData,
} from "@/infrastructure/search/search-index-jobs";

function activeJob(data: SearchIndexJobData, id = "job-1"): ActiveJob<SearchIndexJobData> {
  return { id, queue: "search-index", name: `search.${data.operation}`, data, attempt: 1, maxAttempts: 3 };
}

describe("infrastructure/search/search-index-jobs", () => {
  describe("searchIndexJobId", () => {
    it("is derived from operation/kind/entityId/eventId", () => {
      const id = searchIndexJobId({ operation: "index", kind: "PROFESSIONAL", entityId: "p1", eventId: "evt-1" });
      expect(id).toBe("search:index:PROFESSIONAL:p1:evt-1");
    });

    it("the same event id always produces the same job id (redelivery collapses)", () => {
      const request = { operation: "index" as const, kind: "PROFESSIONAL" as const, entityId: "p1", eventId: "evt-1" };
      expect(searchIndexJobId(request)).toBe(searchIndexJobId(request));
    });

    it("a later edit (a new event id) produces a distinct job id", () => {
      const first = searchIndexJobId({ operation: "index", kind: "PROFESSIONAL", entityId: "p1", eventId: "evt-1" });
      const second = searchIndexJobId({ operation: "index", kind: "PROFESSIONAL", entityId: "p1", eventId: "evt-2" });
      expect(first).not.toBe(second);
    });

    it("falls back to 'manual' when no event id is available, coalescing concurrent manual requests", () => {
      const request = { operation: "index" as const, kind: "PROFESSIONAL" as const, entityId: "p1" };
      expect(searchIndexJobId(request)).toBe(searchIndexJobId(request));
      expect(searchIndexJobId(request)).toBe("search:index:PROFESSIONAL:p1:manual");
    });
  });

  describe("searchIndexJobIdempotencyKey", () => {
    it("matches searchIndexJobId's shape for the same request", () => {
      const job = activeJob({ operation: "index", kind: "PROFESSIONAL", entityId: "p1", eventId: "evt-1" });
      expect(searchIndexJobIdempotencyKey(job)).toBe("search:index:PROFESSIONAL:p1:evt-1");
    });

    it("returns null for a rebuild job, opting out of de-duplication", () => {
      const job = activeJob({ operation: "rebuild" });
      expect(searchIndexJobIdempotencyKey(job)).toBeNull();
    });

    it("falls back to the job's own id when no event id is present", () => {
      const job = activeJob({ operation: "delete", kind: "COMPANY", entityId: "c1" }, "job-42");
      expect(searchIndexJobIdempotencyKey(job)).toBe("search:delete:COMPANY:c1:job-42");
    });
  });
});
