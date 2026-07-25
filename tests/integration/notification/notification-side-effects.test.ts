import { describe, expect, it } from "vitest";

import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import { CompleteJobUseCase } from "@/application/use-cases/job/complete-job.use-case";
import { StartJobUseCase } from "@/application/use-cases/job/start-job.use-case";
import { AcceptQuoteUseCase } from "@/application/use-cases/quotes/accept-quote.use-case";
import { CreateQuoteUseCase } from "@/application/use-cases/quotes/create-quote.use-case";
import { CreateReviewUseCase } from "@/application/use-cases/review/create-review.use-case";
import { SendMessageUseCase } from "@/application/use-cases/chat/send-message.use-case";
import { NullJobNotifier } from "@/application/ports/job-notifier";
import {
  FakeCustomerProfileRepository,
  FakeJobRepository,
  FakeQuoteAcceptanceRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
  createAppointmentStore,
  createJobStore,
} from "../booking/fakes";
import {
  FakeProfessionalDiscoveryRepository,
  FakeProfessionalRepository,
  FakeServiceRequestDiscoveryRepository,
} from "../quotes/fakes";
import { FakeReviewRepository } from "../review/fakes";
import { FakeConversationRepository, FakeMessageRepository } from "../chat/fakes";

/**
 * Integration tests proving the Notifications module's central reliability
 * guarantee: a notification-creation failure must NEVER break the primary
 * business operation that triggered it (quote creation/acceptance, job
 * completion, review creation, sending a chat message). Every notifier
 * call site in this codebase wraps NotificationCreator.notify in its own
 * try/catch specifically so this holds — these tests exercise that
 * contract end to end with a NotificationCreator double that always
 * throws, using the *real* use cases and fake repositories (no mocking of
 * the primary business logic itself).
 */

class ThrowingNotificationCreator implements NotificationCreator {
  async notify(): Promise<void> {
    throw new Error("simulated notification service outage");
  }
}

class RecordingNotificationCreator implements NotificationCreator {
  events: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

const CATEGORY_ID = "cat-plumbing";

describe("Notification failures never break the primary business operation", () => {
  it("quote creation succeeds even when the notification service throws", async () => {
    const professionals = new FakeProfessionalRepository();
    const professionalDiscovery = new FakeProfessionalDiscoveryRepository();
    const requestDiscovery = new FakeServiceRequestDiscoveryRepository();
    const quotes = new FakeQuoteRepository();

    const professional = professionals.seed({ userId: "pro-1", status: "ACTIVE", categoryIds: [CATEGORY_ID] });
    professionalDiscovery.seed({
      id: professional.id,
      displayName: "Jane",
      businessName: null,
      headline: null,
      yearsExperience: 5,
      hourlyRate: 40,
      serviceRadiusKm: 25,
      verificationStatus: "VERIFIED",
      profileImageUrl: null,
      categoryIds: [CATEGORY_ID],
      latitude: 38.9226,
      longitude: -0.1197,
      city: null,
      province: null,
      averageRating: null,
      reviewCount: 0,
      portfolioItemCount: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    });
    requestDiscovery.seed({
      id: "request-1",
      title: "Fix tap",
      description: "Dripping tap",
      categoryId: CATEGORY_ID,
      categoryName: "Plumbing",
      urgency: "MEDIUM",
      city: "Oliva",
      province: "Valencia",
      latitude: 38.9226,
      longitude: -0.1197,
      customerUserId: "customer-1",
      createdAt: new Date(),
    });

    const createQuote = new CreateQuoteUseCase(
      professionals,
      professionalDiscovery,
      requestDiscovery,
      quotes,
      new ThrowingNotificationCreator(),
    );

    const quote = await createQuote.execute("pro-1", {
      serviceRequestId: "request-1",
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
      notes: undefined,
      validUntil: undefined,
    });

    expect(quote.id).toBeTruthy();
    expect(quote.status).toBe("SENT");
  });

  it("quote acceptance (and the QUOTE_ACCEPTED/QUOTE_REJECTED notifications it triggers) never fails the acceptance itself", async () => {
    const customerProfiles = new FakeCustomerProfileRepository();
    const serviceRequests = new FakeServiceRequestRepository();
    const quotes = new FakeQuoteRepository();
    const professionals = new FakeProfessionalRepository();
    const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests);

    const customer = await customerProfiles.findOrCreateByUserId("customer-1");
    const winningPro = professionals.seed({ userId: "pro-winner", status: "ACTIVE" });
    const losingPro = professionals.seed({ userId: "pro-loser", status: "ACTIVE" });

    const request = serviceRequests.seed({
      id: "request-1",
      customerId: customer.id,
      categoryId: CATEGORY_ID,
      categoryName: "Plumbing",
      title: "Fix tap",
      description: "Dripping",
      status: "PUBLISHED",
      urgency: "MEDIUM",
      budgetMin: null,
      budgetMax: null,
      location: {
        line1: "Calle 1",
        line2: null,
        city: "Oliva",
        province: "Valencia",
        postalCode: "46780",
        country: "ES",
        latitude: null,
        longitude: null,
      },
      photos: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const winningQuote = await quotes.create({
      serviceRequestId: request.id,
      professionalProfileId: winningPro.id,
      submittedByUserId: winningPro.userId,
      totalAmount: 100,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
    });
    await quotes.create({
      serviceRequestId: request.id,
      professionalProfileId: losingPro.id,
      submittedByUserId: losingPro.userId,
      totalAmount: 150,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 150 }],
    });

    const acceptQuote = new AcceptQuoteUseCase(
      customerProfiles,
      serviceRequests,
      quotes,
      quoteAcceptance,
      professionals,
      new ThrowingNotificationCreator(),
    );

    const result = await acceptQuote.execute("customer-1", request.id, winningQuote.id);
    expect(result.acceptedQuoteId).toBe(winningQuote.id);
    expect(result.job.status).toBe("CREATED");
  });

  it("job completion succeeds even when the notification service throws", async () => {
    const customerProfiles = new FakeCustomerProfileRepository();
    const professionals = new FakeProfessionalRepository();
    const jobStore = createJobStore();
    const appointmentStore = createAppointmentStore();
    const jobs = new FakeJobRepository(jobStore, appointmentStore);

    const customer = await customerProfiles.findOrCreateByUserId("customer-1");
    const professional = professionals.seed({ userId: "pro-1", status: "ACTIVE" });

    jobStore.set("job-1", {
      id: "job-1",
      serviceRequestId: "request-1",
      quoteId: "quote-1",
      customerId: customer.id,
      professionalProfileId: professional.id,
      companyProfileId: null,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      startedByUserId: professional.userId,
      completedAt: null,
      completedByUserId: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const completeJob = new CompleteJobUseCase(
      jobs,
      customerProfiles,
      professionals,
      new NullJobNotifier(),
      new ThrowingNotificationCreator(),
    );

    const completed = await completeJob.execute("pro-1", "job-1");
    expect(completed.status).toBe("COMPLETED");
  });

  it("starting a job succeeds even when the notification service throws", async () => {
    const customerProfiles = new FakeCustomerProfileRepository();
    const professionals = new FakeProfessionalRepository();
    const jobStore = createJobStore();
    const appointmentStore = createAppointmentStore();
    const jobs = new FakeJobRepository(jobStore, appointmentStore);

    const customer = await customerProfiles.findOrCreateByUserId("customer-1");
    const professional = professionals.seed({ userId: "pro-1", status: "ACTIVE" });

    jobStore.set("job-1", {
      id: "job-1",
      serviceRequestId: "request-1",
      quoteId: "quote-1",
      customerId: customer.id,
      professionalProfileId: professional.id,
      companyProfileId: null,
      status: "CREATED",
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
    });

    const startJob = new StartJobUseCase(
      jobs,
      customerProfiles,
      professionals,
      new NullJobNotifier(),
      new ThrowingNotificationCreator(),
    );

    const started = await startJob.execute("pro-1", "job-1");
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("review creation succeeds even when the notification service throws, and notifies only the professional (never the reviewer)", async () => {
    const customerProfiles = new FakeCustomerProfileRepository();
    const professionals = new FakeProfessionalRepository();
    const reviews = new FakeReviewRepository();
    const jobStore = createJobStore();
    const appointmentStore = createAppointmentStore();
    const jobs = new FakeJobRepository(jobStore, appointmentStore);

    const customer = await customerProfiles.findOrCreateByUserId("customer-1");
    const professional = professionals.seed({ userId: "pro-1", status: "ACTIVE" });

    jobStore.set("job-1", {
      id: "job-1",
      serviceRequestId: "request-1",
      quoteId: "quote-1",
      customerId: customer.id,
      professionalProfileId: professional.id,
      companyProfileId: null,
      status: "COMPLETED",
      startedAt: new Date(),
      startedByUserId: professional.userId,
      completedAt: new Date(),
      completedByUserId: professional.userId,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // First: prove the review itself still succeeds under a throwing notifier.
    const createReviewThrowing = new CreateReviewUseCase(
      reviews,
      jobs,
      customerProfiles,
      professionals,
      new ThrowingNotificationCreator(),
    );
    const review = await createReviewThrowing.execute("customer-1", { jobId: "job-1", rating: 5, comment: "Great!" });
    expect(review.id).toBeTruthy();
    expect(review.reviewerId).toBe("customer-1");

    // Second: prove exactly one notification is created, and it goes to the
    // professional's userId — never the reviewer/customer.
    jobStore.set("job-2", {
      id: "job-2",
      serviceRequestId: "request-2",
      quoteId: "quote-2",
      customerId: customer.id,
      professionalProfileId: professional.id,
      companyProfileId: null,
      status: "COMPLETED",
      startedAt: new Date(),
      startedByUserId: professional.userId,
      completedAt: new Date(),
      completedByUserId: professional.userId,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const recorder = new RecordingNotificationCreator();
    const createReviewRecording = new CreateReviewUseCase(reviews, jobs, customerProfiles, professionals, recorder);
    await createReviewRecording.execute("customer-1", { jobId: "job-2", rating: 4, comment: null });

    expect(recorder.events).toHaveLength(1);
    expect(recorder.events[0]?.userId).toBe(professional.userId);
    expect(recorder.events[0]?.userId).not.toBe("customer-1");
    expect(recorder.events[0]?.type).toBe("REVIEW_RECEIVED");
  });

  it("sending a chat message succeeds even when the notification service throws, and notifies only the other participant", async () => {
    const conversations = new FakeConversationRepository();
    const messages = new FakeMessageRepository(conversations);

    const conversation = await conversations.create("request-1", ["customer-1", "pro-1"]);

    const sendMessageThrowing = new SendMessageUseCase(conversations, messages, new ThrowingNotificationCreator());
    const message = await sendMessageThrowing.execute("customer-1", conversation.id, "Hello there!");
    expect(message.id).toBeTruthy();
    expect(message.body).toBe("Hello there!");

    const recorder = new RecordingNotificationCreator();
    const sendMessageRecording = new SendMessageUseCase(conversations, messages, recorder);
    await sendMessageRecording.execute("customer-1", conversation.id, "Second message");

    expect(recorder.events).toHaveLength(1);
    expect(recorder.events[0]?.userId).toBe("pro-1");
    expect(recorder.events[0]?.userId).not.toBe("customer-1");
    expect(recorder.events[0]?.type).toBe("NEW_MESSAGE");
  });
});
