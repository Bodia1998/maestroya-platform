import { describe, expect, it, vi } from "vitest";

import { ReviewCreated } from "@/domain/events/review-created";
import type { JobRecord, JobRepository } from "@/domain/repositories/job-repository";
import type { SearchIndexQueue } from "@/application/ports/search-index-queue";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import { ReindexReviewedProfileSubscriber } from "@/application/use-cases/search-indexing/reindex-reviewed-profile.subscriber";

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    serviceRequestId: "request-1",
    quoteId: "quote-1",
    customerId: "customer-1",
    professionalProfileId: null,
    companyProfileId: null,
    status: "COMPLETED",
    startedAt: null,
    startedByUserId: null,
    completedAt: null,
    completedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    cancellationNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeJobs(record: JobRecord | null): JobRepository {
  return { findById: vi.fn().mockResolvedValue(record) } as unknown as JobRepository;
}

describe("application/use-cases/search-indexing/reindex-reviewed-profile.subscriber", () => {
  it("enqueues a re-index for the professional attached to the job", async () => {
    const queue: SearchIndexQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const subscriber = new ReindexReviewedProfileSubscriber(fakeJobs(job({ professionalProfileId: "prof-1" })), queue);
    const event = new ReviewCreated("review-1", "job-1", "reviewer-1", "user-1", 5);

    await subscriber.handle(event);

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "index", kind: "PROFESSIONAL", entityId: "prof-1", eventId: event.eventId }),
    );
  });

  it("enqueues a re-index for the company attached to the job", async () => {
    const queue: SearchIndexQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const subscriber = new ReindexReviewedProfileSubscriber(fakeJobs(job({ companyProfileId: "company-1" })), queue);

    await subscriber.handle(new ReviewCreated("review-1", "job-1", "reviewer-1", null, 5));

    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "COMPANY", entityId: "company-1" }));
  });

  it("enqueues nothing when the job has neither a professional nor a company attached", async () => {
    const queue: SearchIndexQueue = { enqueue: vi.fn() };
    const subscriber = new ReindexReviewedProfileSubscriber(fakeJobs(job()), queue);

    await subscriber.handle(new ReviewCreated("review-1", "job-1", "reviewer-1", null, 5));

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues nothing when the job no longer exists", async () => {
    const queue: SearchIndexQueue = { enqueue: vi.fn() };
    const subscriber = new ReindexReviewedProfileSubscriber(fakeJobs(null), queue);

    await subscriber.handle(new ReviewCreated("review-1", "missing-job", "reviewer-1", null, 5));

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("swallows a repository failure and reports it rather than rethrowing", async () => {
    const failure = new Error("db down");
    const jobs = { findById: vi.fn().mockRejectedValue(failure) } as unknown as JobRepository;
    const queue: SearchIndexQueue = { enqueue: vi.fn() };
    const onError = vi.fn();
    const observer: SearchObserver = { ...nullSearchObserver, onError };
    const subscriber = new ReindexReviewedProfileSubscriber(jobs, queue, observer);

    await expect(
      subscriber.handle(new ReviewCreated("review-1", "job-1", "reviewer-1", null, 5)),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error: failure }));
  });
});
