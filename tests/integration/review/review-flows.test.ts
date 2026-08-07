import { describe, expect, it, vi } from "vitest";

import { NullJobNotifier } from "@/application/ports/job-notifier";
import { NullAppointmentNotifier } from "@/application/ports/appointment-notifier";
import { CancelJobUseCase } from "@/application/use-cases/job/cancel-job.use-case";
import { CompleteJobUseCase } from "@/application/use-cases/job/complete-job.use-case";
import { StartJobUseCase } from "@/application/use-cases/job/start-job.use-case";
import { CompleteAppointmentUseCase } from "@/application/use-cases/booking/complete-appointment.use-case";
import { ConfirmAppointmentUseCase } from "@/application/use-cases/booking/confirm-appointment.use-case";
import { ProposeAppointmentTimeUseCase } from "@/application/use-cases/booking/propose-appointment-time.use-case";
import { CreateReviewUseCase } from "@/application/use-cases/review/create-review.use-case";
import { DeleteReviewUseCase } from "@/application/use-cases/review/delete-review.use-case";
import { GetProfessionalRatingSummaryUseCase } from "@/application/use-cases/review/get-professional-rating-summary.use-case";
import { GetReviewByJobUseCase } from "@/application/use-cases/review/get-review-by-job.use-case";
import { ListProfessionalReviewsUseCase } from "@/application/use-cases/review/list-professional-reviews.use-case";
import { RespondToReviewUseCase } from "@/application/use-cases/review/respond-to-review.use-case";
import { UpdateReviewUseCase } from "@/application/use-cases/review/update-review.use-case";
import { RecordReviewCreatedAuditLogSubscriber } from "@/application/use-cases/review/record-review-created-audit-log.subscriber";
import { RecordReviewDeletedAuditLogSubscriber } from "@/application/use-cases/review/record-review-deleted-audit-log.subscriber";
import { RecordReviewResponseAddedAuditLogSubscriber } from "@/application/use-cases/review/record-review-response-added-audit-log.subscriber";
import { RecordReviewUpdatedAuditLogSubscriber } from "@/application/use-cases/review/record-review-updated-audit-log.subscriber";
import { NotifyReviewCreatedSubscriber } from "@/application/use-cases/notification/notify-review-created.subscriber";
import { NotifyReviewResponseAddedSubscriber } from "@/application/use-cases/notification/notify-review-response-added.subscriber";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { ReviewCreated } from "@/domain/events/review-created";
import { ReviewDeleted } from "@/domain/events/review-deleted";
import { ReviewResponseAdded } from "@/domain/events/review-response-added";
import { ReviewUpdated } from "@/domain/events/review-updated";
import { REVIEW_EDIT_WINDOW_HOURS } from "@/domain/services/review-rules";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import {
  FakeAppointmentRepository,
  FakeCustomerProfileRepository,
  FakeJobRepository,
  FakeQuoteAcceptanceRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
  createAppointmentStore,
  createJobStore,
} from "../booking/fakes";
import { FakeProfessionalRepository } from "../quotes/fakes";
import { FakeAdminAuditLogRepository, FakeNotificationCreator, FakeReviewRepository } from "./fakes";

/**
 * Integration tests for the Reviews & Ratings module (Module 13), built on
 * top of the same accepted-quote -> Job pipeline job-flows.test.ts exercises
 * for Module 11. Real use cases + domain services, fake repositories
 * swapped in for storage — same pattern as every other module's
 * integration tests.
 */

let counter = 0;

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const appointmentStore = createAppointmentStore();
  const jobStore = createJobStore();
  const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests, appointmentStore, jobStore);
  const appointments = new FakeAppointmentRepository(appointmentStore);
  const jobs = new FakeJobRepository(jobStore, appointmentStore);
  const reviews = new FakeReviewRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  const notifications = new FakeNotificationCreator();
  return {
    customerProfiles,
    professionals,
    serviceRequests,
    quotes,
    quoteAcceptance,
    appointments,
    jobs,
    reviews,
    auditLog,
    notifications,
  };
}

type Repos = ReturnType<typeof makeRepos>;

/**
 * Find-or-create by userId — mirrors FakeCustomerProfileRepository's own
 * `findOrCreateByUserId` convention. FakeProfessionalRepository.create
 * (unlike the customer-profile fake) always inserts a brand-new profile
 * row with no dedup by userId, so calling it unconditionally here would
 * silently mint a *different* professional profile every time the same
 * userId is seeded twice — exactly what several tests below do on purpose
 * (seedCompletedJob is called multiple times for the same PROFESSIONAL
 * userId to build up multiple reviews against one professional for the
 * rating-aggregation assertions). Without this dedup, those reviews would
 * end up scattered across several distinct fake professional ids instead
 * of accumulating on one, and the aggregate would never match.
 */
async function seedProfessional(repos: Repos, userId: string) {
  const existing = await repos.professionals.findByUserId(userId);
  if (existing) return existing;
  return repos.professionals.create(userId, {});
}

async function seedRequest(repos: Repos, customerUserId: string): Promise<ServiceRequestRecord> {
  const customer = await repos.customerProfiles.findOrCreateByUserId(customerUserId);
  counter += 1;
  const now = new Date();
  return repos.serviceRequests.seed({
    id: `request-${counter}`,
    customerId: customer.id,
    categoryId: "cat-plumbing",
    categoryName: "Plumbing",
    title: "Fix leaking kitchen tap",
    description: "Dripping for a week.",
    status: "PUBLISHED",
    urgency: "MEDIUM",
    budgetMin: null,
    budgetMax: null,
    location: {
      line1: "Calle Mayor 1",
      line2: null,
      city: "Oliva",
      province: "Valencia",
      postalCode: "46780",
      country: "ES",
      latitude: null,
      longitude: null,
    },
    photos: [],
    createdAt: now,
    updatedAt: now,
  });
}

async function seedJob(repos: Repos, customerUserId: string, professionalUserId: string) {
  const professional = await seedProfessional(repos, professionalUserId);
  const request = await seedRequest(repos, customerUserId);
  const quote = await repos.quotes.create({
    serviceRequestId: request.id,
    professionalProfileId: professional.id,
    submittedByUserId: professionalUserId,
    totalAmount: 100,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
  });
  const result = await repos.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id });
  return { request, professional, job: result.job, appointment: result.appointment };
}

function future(hoursFromNow: number, durationMinutes = 60) {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return { start, end };
}

function makeUseCases(repos: Repos) {
  const jobNotifier = new NullJobNotifier();
  const appointmentNotifier = new NullAppointmentNotifier();

  // Module 41 — Domain Event Subscribers: the review use cases below
  // publish ReviewCreated/ReviewUpdated/ReviewDeleted/ReviewResponseAdded
  // instead of calling repos.auditLog/repos.notifications directly — wire a
  // real `SynchronousEventBus` with the real subscribers so this
  // integration test still exercises the full, genuine side-effect path
  // end to end, same pattern as tests/integration/dispute/dispute-flows.test.ts.
  const reviewEventBus = new SynchronousEventBus();
  reviewEventBus.subscribe(ReviewCreated, new RecordReviewCreatedAuditLogSubscriber(repos.auditLog));
  reviewEventBus.subscribe(ReviewCreated, new NotifyReviewCreatedSubscriber(repos.notifications));
  reviewEventBus.subscribe(ReviewUpdated, new RecordReviewUpdatedAuditLogSubscriber(repos.auditLog));
  reviewEventBus.subscribe(ReviewDeleted, new RecordReviewDeletedAuditLogSubscriber(repos.auditLog));
  reviewEventBus.subscribe(ReviewResponseAdded, new RecordReviewResponseAddedAuditLogSubscriber(repos.auditLog));
  reviewEventBus.subscribe(ReviewResponseAdded, new NotifyReviewResponseAddedSubscriber(repos.notifications));

  return {
    start: new StartJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, jobNotifier),
    complete: new CompleteJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, jobNotifier),
    cancel: new CancelJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, jobNotifier),
    propose: new ProposeAppointmentTimeUseCase(
      repos.appointments,
      repos.customerProfiles,
      repos.professionals,
      repos.serviceRequests,
      appointmentNotifier,
    ),
    confirm: new ConfirmAppointmentUseCase(
      repos.appointments,
      repos.customerProfiles,
      repos.professionals,
      repos.serviceRequests,
      appointmentNotifier,
    ),
    completeAppointment: new CompleteAppointmentUseCase(
      repos.appointments,
      repos.customerProfiles,
      repos.professionals,
      repos.serviceRequests,
      appointmentNotifier,
    ),
    createReview: new CreateReviewUseCase(
      repos.reviews,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      reviewEventBus,
    ),
    updateReview: new UpdateReviewUseCase(repos.reviews, reviewEventBus),
    deleteReview: new DeleteReviewUseCase(repos.reviews, reviewEventBus),
    respondToReview: new RespondToReviewUseCase(repos.reviews, repos.professionals, reviewEventBus),
    getReviewByJob: new GetReviewByJobUseCase(repos.reviews, repos.jobs, repos.customerProfiles, repos.professionals),
    listProfessionalReviews: new ListProfessionalReviewsUseCase(repos.reviews),
    getRatingSummary: new GetProfessionalRatingSummaryUseCase(repos.reviews),
  };
}

const CUSTOMER = "user-customer-1";
const PROFESSIONAL = "user-pro-1";
const OTHER_CUSTOMER = "user-customer-2";
const OTHER_PROFESSIONAL = "user-pro-2";

/**
 * Drives an appointment from PENDING_SCHEDULE to CONFIRMED. Must be called
 * with the *actual* customer/professional userIds the appointment belongs
 * to (see resolveAppointmentActor) — propose/confirm re-derive ownership
 * from the Appointment's own ServiceRequest.customerId/
 * professionalProfileId, so calling this with the wrong pair throws the
 * same NotFoundError an unrelated caller would get, not a silent no-op.
 * job-flows.test.ts could hardcode CUSTOMER/PROFESSIONAL here because it
 * only ever seeds jobs for that one pair; this module also seeds jobs for
 * OTHER_CUSTOMER/OTHER_PROFESSIONAL and other ad-hoc userIds (see the
 * rating-aggregation tests below), so the actors must be threaded through
 * instead.
 */
async function confirmTheJobsAppointment(
  repos: Repos,
  appointmentId: string,
  customerUserId: string,
  professionalUserId: string,
) {
  const { propose, confirm } = makeUseCases(repos);
  const { start, end } = future(24);
  await propose.execute(customerUserId, appointmentId, start, end);
  await confirm.execute(professionalUserId, appointmentId);
}

/** Drives a freshly-seeded Job all the way to COMPLETED — every review test
 *  that needs a reviewable Job starts from this. */
async function seedCompletedJob(
  repos: Repos,
  customerUserId: string = CUSTOMER,
  professionalUserId: string = PROFESSIONAL,
) {
  const { job, appointment, professional } = await seedJob(repos, customerUserId, professionalUserId);
  await confirmTheJobsAppointment(repos, appointment.id, customerUserId, professionalUserId);
  const { start, complete, completeAppointment } = makeUseCases(repos);
  await start.execute(professionalUserId, job.id);
  await completeAppointment.execute(professionalUserId, appointment.id);
  const completed = await complete.execute(professionalUserId, job.id);
  return { job: completed, professional };
}

describe("Server Action auth boundary (unauthenticated users)", () => {
  it("requireAuth throws (and never resolves a userId) when there is no session", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
    const { requireAuth } = await import("@/infrastructure/auth/rbac");

    await expect(requireAuth()).rejects.toThrow(UnauthorizedError);

    vi.doUnmock("@/lib/auth");
  });
});

describe("Create Review — eligibility (Job.status)", () => {
  it("allows the authenticated customer to review their own COMPLETED job", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);

    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Excellent work!" });
    expect(review.jobId).toBe(job.id);
    expect(review.rating).toBe(5);
    expect(review.comment).toBe("Excellent work!");
    expect(review.reviewerId).toBe(CUSTOMER);
    expect(review.status).toBe("PUBLISHED");
  });

  it("rejects reviewing a job that is still CREATED", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { createReview } = makeUseCases(repos);

    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects reviewing a job that is IN_PROGRESS", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start, createReview } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);

    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects reviewing a CANCELLED job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { cancel, createReview } = makeUseCases(repos);
    await cancel.execute(CUSTOMER, job.id, "CUSTOMER_REQUEST", null);

    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("a not-found job id fails the same way for anyone (no existence probing)", async () => {
    const repos = makeRepos();
    await repos.customerProfiles.findOrCreateByUserId(CUSTOMER);
    const { createReview } = makeUseCases(repos);

    await expect(
      createReview.execute(CUSTOMER, { jobId: "does-not-exist", rating: 5, comment: null }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("Create Review — authorization", () => {
  it("rejects an unrelated customer from reviewing another customer's job", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);
    const { createReview } = makeUseCases(repos);

    await expect(
      createReview.execute(OTHER_CUSTOMER, { jobId: job.id, rating: 5, comment: null }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects the professional from creating a review as the customer", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);

    await expect(createReview.execute(PROFESSIONAL, { jobId: job.id, rating: 5, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("a completely unrelated professional gets the same NotFoundError, not a distinguishable forbidden", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    await seedProfessional(repos, OTHER_PROFESSIONAL);
    const { createReview } = makeUseCases(repos);

    await expect(
      createReview.execute(OTHER_PROFESSIONAL, { jobId: job.id, rating: 5, comment: null }),
    ).rejects.toThrow(NotFoundError);
  });

  it("the reviewee is always derived from the Job — never client-suppliable", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedCompletedJob(repos);
    await seedProfessional(repos, OTHER_PROFESSIONAL);
    const { createReview } = makeUseCases(repos);

    // CreateReviewInput (jobId, rating, comment) has no professionalId
    // field at all — there is no way for a caller to redirect the review
    // to a different professional even in principle. This test documents
    // that fact by asserting the persisted review's reviewee always
    // matches the Job's own professional.
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: null });
    expect(review.revieweeProfessionalProfileId).toBe(professional.id);
  });

  it("a client-supplied customerId cannot bypass authorization — only the session userId is ever used", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);

    // CreateReviewUseCase.execute takes `userId` positionally from the
    // caller (the Server Action passes `requireAuth()`'s session id, never
    // a body field) — there is no `customerId` parameter anywhere in its
    // signature to smuggle a different identity through.
    await expect(
      createReview.execute(OTHER_CUSTOMER, { jobId: job.id, rating: 5, comment: null }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("Create Review — one review per job", () => {
  it("only one review can exist for a job", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Great!" });

    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: "Actually meh." })).rejects.toThrow(
      ConflictError,
    );
  });

  it("a duplicate review attempt returns ConflictError, not a generic error", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: null });

    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: null })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("only one of two concurrent duplicate review attempts can win", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);

    const [a, b] = await Promise.allSettled([
      createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "First." }),
      createReview.execute(CUSTOMER, { jobId: job.id, rating: 1, comment: "Second." }),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const stored = await repos.reviews.findByJobId(job.id);
    expect(stored).not.toBeNull();
  });
});

describe("Create Review — rating validation", () => {
  it("accepts rating 1", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 1, comment: null });
    expect(review.rating).toBe(1);
  });

  it("accepts rating 5", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: null });
    expect(review.rating).toBe(5);
  });

  it("rejects rating 0", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: 0, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a rating above 5", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: 6, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a negative rating", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: -2, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a non-integer rating", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    await expect(createReview.execute(CUSTOMER, { jobId: job.id, rating: 3.5, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("normalizes a whitespace-only comment to null", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: "    " });
    expect(review.comment).toBeNull();
  });
});

describe("Read reviews", () => {
  it("the professional can retrieve their own reviews", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedCompletedJob(repos);
    const { createReview, listProfessionalReviews } = makeUseCases(repos);
    await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Great!" });

    const reviews = await listProfessionalReviews.execute(professional.id, { limit: 20, offset: 0 });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.revieweeProfessionalProfileId).toBe(professional.id);
  });

  it("the customer can retrieve their own job's review", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, getReviewByJob } = makeUseCases(repos);
    await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Great!" });

    const review = await getReviewByJob.execute(CUSTOMER, job.id);
    expect(review?.jobId).toBe(job.id);
  });

  it("the professional can retrieve the review for their own job", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, getReviewByJob } = makeUseCases(repos);
    await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Great!" });

    const review = await getReviewByJob.execute(PROFESSIONAL, job.id);
    expect(review?.jobId).toBe(job.id);
  });

  it("returns null (not an error) for a completed job with no review yet", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { getReviewByJob } = makeUseCases(repos);

    const review = await getReviewByJob.execute(CUSTOMER, job.id);
    expect(review).toBeNull();
  });

  it("an unrelated user cannot probe another customer's job/review relationship", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);
    const { createReview, getReviewByJob } = makeUseCases(repos);
    await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Great!" });

    await expect(getReviewByJob.execute(OTHER_CUSTOMER, job.id)).rejects.toThrow(NotFoundError);
  });

  it("public review listing does not expose the reviewer's identity as customer-identifying data beyond the raw user id", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedCompletedJob(repos);
    const { createReview, listProfessionalReviews } = makeUseCases(repos);
    await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Great!" });

    const reviews = await listProfessionalReviews.execute(professional.id, { limit: 20, offset: 0 });
    expect(reviews).toHaveLength(1);
    const keys = Object.keys(reviews[0]!).sort();
    // No name/email/contact fields are ever joined in — only the raw
    // reviewerId (a User.id) that the presentation layer may or may not
    // choose to resolve to a display name.
    expect(keys).not.toContain("reviewerEmail");
    expect(keys).not.toContain("reviewerName");
  });

  it("reviews for different professionals remain correctly isolated", async () => {
    const repos = makeRepos();
    const first = await seedCompletedJob(repos, CUSTOMER, PROFESSIONAL);
    const second = await seedCompletedJob(repos, OTHER_CUSTOMER, OTHER_PROFESSIONAL);
    const { createReview, listProfessionalReviews } = makeUseCases(repos);
    await createReview.execute(CUSTOMER, { jobId: first.job.id, rating: 5, comment: null });
    await createReview.execute(OTHER_CUSTOMER, { jobId: second.job.id, rating: 1, comment: null });

    const firstReviews = await listProfessionalReviews.execute(first.professional.id, { limit: 20, offset: 0 });
    const secondReviews = await listProfessionalReviews.execute(second.professional.id, { limit: 20, offset: 0 });
    expect(firstReviews).toHaveLength(1);
    expect(firstReviews[0]?.rating).toBe(5);
    expect(secondReviews).toHaveLength(1);
    expect(secondReviews[0]?.rating).toBe(1);
  });
});

describe("Professional rating aggregation", () => {
  it("returns null average and 0 count when a professional has no reviews", async () => {
    const repos = makeRepos();
    const professional = await seedProfessional(repos, PROFESSIONAL);
    const { getRatingSummary } = makeUseCases(repos);

    const summary = await getRatingSummary.execute(professional.id);
    expect(summary.averageRating).toBeNull();
    expect(summary.reviewCount).toBe(0);
  });

  it("computes the correct average for multiple reviews", async () => {
    const repos = makeRepos();
    const { createReview, getRatingSummary } = makeUseCases(repos);

    const job1 = await seedCompletedJob(repos, "customer-a", PROFESSIONAL);
    const job2 = await seedCompletedJob(repos, "customer-b", PROFESSIONAL);
    const job3 = await seedCompletedJob(repos, "customer-c", PROFESSIONAL);
    await createReview.execute("customer-a", { jobId: job1.job.id, rating: 5, comment: null });
    await createReview.execute("customer-b", { jobId: job2.job.id, rating: 4, comment: null });
    await createReview.execute("customer-c", { jobId: job3.job.id, rating: 3, comment: null });

    const summary = await getRatingSummary.execute(job1.professional.id);
    expect(summary.averageRating).toBe(4);
    expect(summary.reviewCount).toBe(3);
  });

  it("review count matches the number of reviews created", async () => {
    const repos = makeRepos();
    const { createReview, getRatingSummary } = makeUseCases(repos);

    const job1 = await seedCompletedJob(repos, "customer-a", PROFESSIONAL);
    const job2 = await seedCompletedJob(repos, "customer-b", PROFESSIONAL);
    await createReview.execute("customer-a", { jobId: job1.job.id, rating: 5, comment: null });
    await createReview.execute("customer-b", { jobId: job2.job.id, rating: 2, comment: null });

    const summary = await getRatingSummary.execute(job1.professional.id);
    expect(summary.reviewCount).toBe(2);
  });

  it("rounds the average to one decimal place", async () => {
    const repos = makeRepos();
    const { createReview, getRatingSummary } = makeUseCases(repos);

    const job1 = await seedCompletedJob(repos, "customer-a", PROFESSIONAL);
    const job2 = await seedCompletedJob(repos, "customer-b", PROFESSIONAL);
    const job3 = await seedCompletedJob(repos, "customer-c", PROFESSIONAL);
    await createReview.execute("customer-a", { jobId: job1.job.id, rating: 5, comment: null });
    await createReview.execute("customer-b", { jobId: job2.job.id, rating: 5, comment: null });
    await createReview.execute("customer-c", { jobId: job3.job.id, rating: 4, comment: null });

    // (5 + 5 + 4) / 3 = 4.666... -> rounds to 4.7
    const summary = await getRatingSummary.execute(job1.professional.id);
    expect(summary.averageRating).toBe(4.7);
  });
});

describe("Existing Job lifecycle behavior remains unaffected", () => {
  it("Job start/complete/cancel still work exactly as before with the Review module wired in", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id, CUSTOMER, PROFESSIONAL);
    const { start, complete, completeAppointment } = makeUseCases(repos);
    const started = await start.execute(PROFESSIONAL, job.id);
    expect(started.status).toBe("IN_PROGRESS");
    await completeAppointment.execute(PROFESSIONAL, appointment.id);
    const completed = await complete.execute(PROFESSIONAL, job.id);
    expect(completed.status).toBe("COMPLETED");
  });

  it("a Job can remain COMPLETED with no review at all — reviewing is optional", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const review = await repos.reviews.findByJobId(job.id);
    expect(review).toBeNull();
  });
});

describe("Module 41 — Domain events", () => {
  it("ReviewCreated fires the audit-log and notification subscribers", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedCompletedJob(repos);
    const { createReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Great!" });

    expect(repos.auditLog.entries.some((e) => e.action === "REVIEW_CREATED" && e.targetId === review.id)).toBe(true);
    const notified = repos.notifications.events.filter((e) => e.type === "REVIEW_RECEIVED");
    expect(notified).toHaveLength(1);
    expect(notified[0]?.userId).toBe(professional.userId);
  });

  it("ReviewUpdated fires the audit-log subscriber (no notification)", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, updateReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: null });
    await updateReview.execute(CUSTOMER, review.id, { rating: 5, comment: "Actually, great!" });

    expect(repos.auditLog.entries.some((e) => e.action === "REVIEW_UPDATED" && e.targetId === review.id)).toBe(true);
  });

  it("ReviewDeleted fires the audit-log subscriber", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, deleteReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: null });
    await deleteReview.execute(CUSTOMER, review.id);

    expect(repos.auditLog.entries.some((e) => e.action === "REVIEW_DELETED" && e.targetId === review.id)).toBe(true);
  });

  it("ReviewResponseAdded fires both the audit-log and notification subscribers", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, respondToReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: "Good work." });
    await respondToReview.execute(PROFESSIONAL, review.id, "Thank you for the feedback!");

    expect(
      repos.auditLog.entries.some((e) => e.action === "REVIEW_RESPONSE_ADDED" && e.targetId === review.id),
    ).toBe(true);
    const notified = repos.notifications.events.filter((e) => e.type === "REVIEW_RESPONSE_ADDED");
    expect(notified).toHaveLength(1);
    expect(notified[0]?.userId).toBe(CUSTOMER);
  });
});

describe("Module 41 — Update Review", () => {
  it("allows the author to edit rating and comment within the edit window", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, updateReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 2, comment: "Meh." });

    const updated = await updateReview.execute(CUSTOMER, review.id, { rating: 5, comment: "Actually excellent!" });
    expect(updated.rating).toBe(5);
    expect(updated.comment).toBe("Actually excellent!");
  });

  it("rejects an edit from anyone other than the review's author", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, updateReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: null });

    await expect(updateReview.execute(PROFESSIONAL, review.id, { rating: 1, comment: null })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rejects editing a review outside the edit window", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, updateReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: null });

    // Simulate the edit window having elapsed by advancing the system
    // clock — UpdateReviewUseCase re-derives the window from the review's
    // own createdAt against `new Date()` at call time (never a
    // client-supplied flag), so this exercises the real "stale edit"
    // branch rather than reaching into the fake's internals.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(review.createdAt.getTime() + (REVIEW_EDIT_WINDOW_HOURS + 1) * 60 * 60 * 1000));
      await expect(updateReview.execute(CUSTOMER, review.id, { rating: 5, comment: null })).rejects.toThrow(
        ValidationError,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid rating on edit", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, updateReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: null });

    await expect(updateReview.execute(CUSTOMER, review.id, { rating: 7, comment: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects editing a review that no longer exists", async () => {
    const repos = makeRepos();
    await repos.customerProfiles.findOrCreateByUserId(CUSTOMER);
    const { updateReview } = makeUseCases(repos);

    await expect(updateReview.execute(CUSTOMER, "does-not-exist", { rating: 5, comment: null })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("Module 41 — Delete Review (soft delete)", () => {
  it("allows the author to delete their own review", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, deleteReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: null });

    const deleted = await deleteReview.execute(CUSTOMER, review.id);
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("rejects deletion from anyone other than the review's author", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, deleteReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: null });

    await expect(deleteReview.execute(PROFESSIONAL, review.id)).rejects.toThrow(NotFoundError);
  });

  it("a soft-deleted review no longer appears in public listings or rating aggregation", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedCompletedJob(repos);
    const { createReview, deleteReview, listProfessionalReviews, getRatingSummary } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 5, comment: "Great!" });
    await deleteReview.execute(CUSTOMER, review.id);

    const reviews = await listProfessionalReviews.execute(professional.id, { limit: 20, offset: 0 });
    expect(reviews).toHaveLength(0);
    const summary = await getRatingSummary.execute(professional.id);
    expect(summary.reviewCount).toBe(0);
    expect(summary.averageRating).toBeNull();
  });

  it("deleting an already-deleted review is rejected, not silently repeated", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, deleteReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 3, comment: null });
    await deleteReview.execute(CUSTOMER, review.id);

    await expect(deleteReview.execute(CUSTOMER, review.id)).rejects.toThrow(NotFoundError);
  });
});

describe("Module 41 — Professional Response", () => {
  it("allows the reviewed professional to respond to a review", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, respondToReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: "Good." });

    const responded = await respondToReview.execute(PROFESSIONAL, review.id, "Thanks for the kind words!");
    expect(responded.response).toBe("Thanks for the kind words!");
    expect(responded.respondedAt).not.toBeNull();
  });

  it("allows the professional to edit their own response", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, respondToReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: "Good." });
    await respondToReview.execute(PROFESSIONAL, review.id, "First response.");

    const edited = await respondToReview.execute(PROFESSIONAL, review.id, "Edited response.");
    expect(edited.response).toBe("Edited response.");
  });

  it("never lets a professional respond to another professional's review", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos, CUSTOMER, PROFESSIONAL);
    await seedProfessional(repos, OTHER_PROFESSIONAL);
    const { createReview, respondToReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: "Good." });

    await expect(respondToReview.execute(OTHER_PROFESSIONAL, review.id, "Not my review!")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rejects the reviewer responding to their own review", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, respondToReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: "Good." });

    await expect(respondToReview.execute(CUSTOMER, review.id, "Replying to myself.")).rejects.toThrow(NotFoundError);
  });

  it("rejects an empty response", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, respondToReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: "Good." });

    await expect(respondToReview.execute(PROFESSIONAL, review.id, "   ")).rejects.toThrow(ValidationError);
  });

  it("rejects responding to a soft-deleted review", async () => {
    const repos = makeRepos();
    const { job } = await seedCompletedJob(repos);
    const { createReview, deleteReview, respondToReview } = makeUseCases(repos);
    const review = await createReview.execute(CUSTOMER, { jobId: job.id, rating: 4, comment: "Good." });
    await deleteReview.execute(CUSTOMER, review.id);

    await expect(respondToReview.execute(PROFESSIONAL, review.id, "Too late!")).rejects.toThrow(NotFoundError);
  });
});

describe("Module 41 — Rating statistics (distribution, last review date)", () => {
  it("returns a zero-filled distribution and null lastReviewAt with no reviews", async () => {
    const repos = makeRepos();
    const professional = await seedProfessional(repos, PROFESSIONAL);
    const { getRatingSummary } = makeUseCases(repos);

    const summary = await getRatingSummary.execute(professional.id);
    expect(summary.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(summary.lastReviewAt).toBeNull();
  });

  it("computes the correct per-star distribution and last review date", async () => {
    const repos = makeRepos();
    const { createReview, getRatingSummary } = makeUseCases(repos);

    const job1 = await seedCompletedJob(repos, "customer-a", PROFESSIONAL);
    const job2 = await seedCompletedJob(repos, "customer-b", PROFESSIONAL);
    const job3 = await seedCompletedJob(repos, "customer-c", PROFESSIONAL);
    await createReview.execute("customer-a", { jobId: job1.job.id, rating: 5, comment: null });
    await createReview.execute("customer-b", { jobId: job2.job.id, rating: 5, comment: null });
    const last = await createReview.execute("customer-c", { jobId: job3.job.id, rating: 3, comment: null });

    const summary = await getRatingSummary.execute(job1.professional.id);
    expect(summary.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 });
    expect(summary.reviewCount).toBe(3);
    expect(summary.lastReviewAt?.getTime()).toBe(last.createdAt.getTime());
  });

  it("excludes a soft-deleted review from the distribution", async () => {
    const repos = makeRepos();
    const { createReview, deleteReview, getRatingSummary } = makeUseCases(repos);

    const job1 = await seedCompletedJob(repos, "customer-a", PROFESSIONAL);
    const job2 = await seedCompletedJob(repos, "customer-b", PROFESSIONAL);
    await createReview.execute("customer-a", { jobId: job1.job.id, rating: 1, comment: null });
    const toDelete = await createReview.execute("customer-b", { jobId: job2.job.id, rating: 5, comment: null });
    await deleteReview.execute("customer-b", toDelete.id);

    const summary = await getRatingSummary.execute(job1.professional.id);
    expect(summary.ratingDistribution).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(summary.reviewCount).toBe(1);
  });
});

describe("Module 41 — List filtering by rating", () => {
  it("filters the public listing to an exact rating", async () => {
    const repos = makeRepos();
    const { createReview, listProfessionalReviews } = makeUseCases(repos);

    const job1 = await seedCompletedJob(repos, "customer-a", PROFESSIONAL);
    const job2 = await seedCompletedJob(repos, "customer-b", PROFESSIONAL);
    await createReview.execute("customer-a", { jobId: job1.job.id, rating: 5, comment: null });
    await createReview.execute("customer-b", { jobId: job2.job.id, rating: 2, comment: null });

    const fiveStar = await listProfessionalReviews.execute(job1.professional.id, {
      limit: 20,
      offset: 0,
      rating: 5,
    });
    expect(fiveStar).toHaveLength(1);
    expect(fiveStar[0]?.rating).toBe(5);
  });
});
