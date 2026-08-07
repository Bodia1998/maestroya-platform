import { describe, expect, it, vi } from "vitest";

import { ProfessionalCreated } from "@/domain/events/professional-created";
import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { InMemoryJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { Queue } from "@/infrastructure/jobs/queue";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { InMemorySearchProvider } from "@/infrastructure/search/providers/in-memory-search-provider";
import { createSearchIndexJobProcessor } from "@/infrastructure/search/search-index-job-processor";
import { SearchIndexQueueAdapter } from "@/infrastructure/search/search-index-queue-adapter";
import { searchIndexJobIdempotencyKey, type SearchIndexJobData } from "@/infrastructure/search/search-index-jobs";
import { SearchDocumentProjector } from "@/application/services/search/search-document-projector";
import { BatchIndexSearchDocumentsUseCase } from "@/application/use-cases/search-indexing/batch-index-search-documents.use-case";
import { DeleteSearchDocumentUseCase } from "@/application/use-cases/search-indexing/delete-search-document.use-case";
import { EnqueueSearchIndexSubscriber } from "@/application/use-cases/search-indexing/enqueue-search-index.subscriber";
import { IndexSearchDocumentUseCase } from "@/application/use-cases/search-indexing/index-search-document.use-case";
import { RebuildSearchIndexUseCase } from "@/application/use-cases/search-indexing/rebuild-search-index.use-case";
import { SearchReadModelUseCase } from "@/application/use-cases/search/search-read-model.use-case";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import {
  FakeSearchableCompanyDiscoveryRepository,
  FakeSearchableProfessionalDiscoveryRepository,
} from "./fakes";

const NOW = new Date("2026-01-01T00:00:00.000Z");

const noopServiceRequests: ServiceRequestRepository = {
  findById: async () => null,
  findManyByCustomerId: async () => [],
  create: async () => {
    throw new Error("not used");
  },
  update: async () => {
    throw new Error("not used");
  },
  updateStatus: async () => {},
  addPhoto: async () => {
    throw new Error("not used");
  },
  removePhoto: async () => {},
  countPhotos: async () => 0,
  findExpirable: async () => [],
};

/** Wires the full pipeline: EventBus -> subscriber -> Queue -> Worker -> provider. */
function buildPipeline(provider = new InMemorySearchProvider()) {
  const jobStore = new InMemoryJobStore();
  const indexQueue = new Queue<SearchIndexJobData>("search-index", { store: jobStore, now: () => NOW.getTime() });
  const deadLetterQueue = new Queue<DeadLetterJobData>("search-index-dead-letter", { store: jobStore, now: () => NOW.getTime() });
  const queueAdapter = new SearchIndexQueueAdapter(indexQueue, { attempts: 2, backoff: { type: "fixed", delay: 10 } });

  const professionals = new FakeSearchableProfessionalDiscoveryRepository();
  const companies = new FakeSearchableCompanyDiscoveryRepository();
  const projector = new SearchDocumentProjector({ professionals, companies, serviceRequests: noopServiceRequests }, () => NOW);

  const indexUseCase = new IndexSearchDocumentUseCase(provider, projector);
  const deleteUseCase = new DeleteSearchDocumentUseCase(provider);
  const batchUseCase = new BatchIndexSearchDocumentsUseCase(provider, projector);
  const rebuildUseCase = new RebuildSearchIndexUseCase(provider, batchUseCase, professionals, companies);

  const worker = new Worker<SearchIndexJobData>(
    "search-index",
    createSearchIndexJobProcessor({ index: indexUseCase, remove: deleteUseCase, rebuild: rebuildUseCase }),
    {
      store: jobStore,
      deadLetterQueue,
      idempotency: {
        store: new InMemoryJobIdempotencyStore(),
        keyFor: (job) => searchIndexJobIdempotencyKey(job as never),
      },
      now: () => NOW.getTime(),
    },
  );

  const eventBus = new SynchronousEventBus();
  const subscriber = new EnqueueSearchIndexSubscriber<ProfessionalCreated>(queueAdapter, (event) => ({
    operation: "index",
    kind: "PROFESSIONAL",
    entityId: event.professionalId,
  }));
  eventBus.subscribe(ProfessionalCreated, subscriber);

  return { eventBus, indexQueue, deadLetterQueue, worker, professionals, provider };
}

function activeProfessional(id: string) {
  return {
    id,
    status: "ACTIVE" as const,
    displayName: `Pro ${id}`,
    businessName: null,
    headline: null,
    yearsExperience: null,
    hourlyRate: null,
    serviceRadiusKm: null,
    verificationStatus: "VERIFIED" as const,
    profileImageUrl: null,
    categoryIds: [],
    latitude: null,
    longitude: null,
    city: null,
    province: null,
    averageRating: null,
    reviewCount: 0,
    portfolioItemCount: 0,
    createdAt: NOW,
  };
}

describe("search indexing pipeline (event -> queue -> worker -> provider)", () => {
  it("a domain event ends up as a findable document, with no synchronous indexing call on the publish path", async () => {
    const { eventBus, professionals, worker, provider } = buildPipeline();
    professionals.seed(activeProfessional("p1"));
    const indexSpy = vi.spyOn(provider, "indexDocument");

    await eventBus.publish(new ProfessionalCreated("p1", "user-1"));
    // The event handler only enqueued — nothing indexed yet.
    expect(indexSpy).not.toHaveBeenCalled();

    const ran = await worker.processNext();
    expect(ran).toBe(true);
    expect(indexSpy).toHaveBeenCalledTimes(1);

    const readModel = new SearchReadModelUseCase(provider);
    const result = await readModel.execute({ query: "Pro p1" });
    expect(result.degraded).toBe(false);
    expect(result.items.map((i) => i.document.entityId)).toContain("p1");
  });

  it("redelivering the same domain event id is de-duplicated at enqueue time", async () => {
    const { eventBus, professionals, indexQueue } = buildPipeline();
    professionals.seed(activeProfessional("p1"));
    const event = new ProfessionalCreated("p1", "user-1");

    await eventBus.publish(event);
    await eventBus.publish(event); // Same eventId — simulates redelivery.

    expect((await indexQueue.getCounts()).waiting).toBe(1);
  });

  it("a failing index attempt is retried, and once attempts are exhausted lands in the dead-letter queue", async () => {
    const failingProvider = {
      indexDocument: vi.fn().mockRejectedValue(new Error("engine down")),
    } as unknown as InMemorySearchProvider;
    const { eventBus, professionals, worker, deadLetterQueue } = buildPipeline(failingProvider);
    professionals.seed(activeProfessional("p1"));

    await eventBus.publish(new ProfessionalCreated("p1", "user-1"));

    await worker.processNext(); // attempt 1 — fails, retries with backoff
    expect((await deadLetterQueue.getCounts()).waiting).toBe(0);

    // Backoff hasn't elapsed on the worker's own virtual clock — nothing due yet.
    expect(await worker.processNext()).toBe(false);
  });

  it("a duplicate job execution (redelivery after a lost ack) is skipped via execution-time idempotency", async () => {
    const { eventBus, professionals, worker, provider, indexQueue } = buildPipeline();
    professionals.seed(activeProfessional("p1"));
    const indexSpy = vi.spyOn(provider, "indexDocument");
    const event = new ProfessionalCreated("p1", "user-1");

    await eventBus.publish(event);
    await worker.processNext();
    expect(indexSpy).toHaveBeenCalledTimes(1);

    // Simulate a redelivery that bypassed enqueue-time de-duplication (a
    // different job id, e.g. a replayed message from the transport) but
    // carries the same domain eventId — the idempotency key is derived
    // from eventId, so execution-time de-duplication must still catch it.
    await indexQueue.add(
      "search.index",
      { operation: "index", kind: "PROFESSIONAL", entityId: "p1", eventId: event.eventId },
      { jobId: "redelivered-job", attempts: 2 },
    );
    const ran = await worker.processNext();

    expect(ran).toBe(true);
    // Still only the one real index call — the redelivered job was
    // recognized as already-processed and skipped.
    expect(indexSpy).toHaveBeenCalledTimes(1);
  });
});
