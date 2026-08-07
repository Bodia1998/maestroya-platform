import type { DomainEvent } from "@/domain/events/domain-event";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { EventHandler } from "@/application/ports/event-bus";
import type { SearchIndexQueue } from "@/application/ports/search-index-queue";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";

/** The shape shared by `ReviewCreated`/`ReviewUpdated`/`ReviewDeleted`. */
interface ReviewEventLike extends DomainEvent {
  readonly reviewId: string;
  readonly jobId: string;
}

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Keeps the read model's rating signals fresh when a review is written,
 * edited, or deleted.
 *
 * A review is not itself a searchable document — nobody searches the
 * directory *for a review*. What a review changes is the reviewed
 * professional's (or company's) `averageRating` and `reviewCount`, and
 * those are indexed fields that filtering (`minRating`) and sorting
 * (`RATING`, `REVIEWS`) depend on. So the correct reaction to a review
 * event is to re-project the *reviewed profile*, which is what this does.
 *
 * ## Why this one subscriber does a repository read
 * Unlike `EnqueueSearchIndexSubscriber`, which extracts an id straight
 * off the event, the Module 41 review events predate this module and
 * carry `reviewId`/`jobId`/`reviewerId` — never the reviewed
 * `ProfessionalProfile.id`. Rather than widen three existing events
 * (touching Module 41's contracts and every one of their existing
 * subscribers and tests), this resolves the reviewee from the Job the
 * event already identifies: a single primary-key read.
 *
 * That read does happen on the publishing request's call stack (the
 * default `SynchronousEventBus` dispatches inline). It is a deliberate
 * and bounded exception to nothing at all: the rule this module enforces
 * is that *indexing* — the network call to the search engine — never
 * happens in a request handler, and it still doesn't. One indexed lookup
 * is the same order of cost as the notification and audit-log
 * subscribers that already react to these events.
 *
 * A Job with neither a professional nor a company attached, or one that
 * no longer exists, enqueues nothing — there is no document to refresh.
 */
export class ReindexReviewedProfileSubscriber<T extends ReviewEventLike> implements EventHandler<T> {
  constructor(
    private readonly jobs: JobRepository,
    private readonly queue: SearchIndexQueue,
    private readonly observer: SearchObserver = nullSearchObserver,
  ) {}

  async handle(event: T): Promise<void> {
    try {
      const job = await this.jobs.findById(event.jobId);
      if (!job) return;

      if (job.professionalProfileId) {
        await this.queue.enqueue({
          operation: "index",
          kind: "PROFESSIONAL",
          entityId: job.professionalProfileId,
          eventId: event.eventId,
          reason: event.eventName,
        });
      }

      if (job.companyProfileId) {
        await this.queue.enqueue({
          operation: "index",
          kind: "COMPANY",
          entityId: job.companyProfileId,
          eventId: event.eventId,
          reason: event.eventName,
        });
      }
    } catch (error) {
      // Same contract as `EnqueueSearchIndexSubscriber`: the review has
      // already been written and is the source of truth. A rating that is
      // briefly stale in the index — and self-heals on the next edit or
      // rebuild — is strictly better than failing the customer's review.
      this.observer.onError({ operation: "enqueue", error });
    }
  }
}
