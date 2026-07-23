import { describe, expect, it, vi } from "vitest";

import { NullJobNotifier } from "@/application/ports/job-notifier";
import { CancelJobUseCase } from "@/application/use-cases/job/cancel-job.use-case";
import { CompleteJobUseCase } from "@/application/use-cases/job/complete-job.use-case";
import { GetJobUseCase } from "@/application/use-cases/job/get-job.use-case";
import { StartJobUseCase } from "@/application/use-cases/job/start-job.use-case";
import { CompleteAppointmentUseCase } from "@/application/use-cases/booking/complete-appointment.use-case";
import { ConfirmAppointmentUseCase } from "@/application/use-cases/booking/confirm-appointment.use-case";
import { ProposeAppointmentTimeUseCase } from "@/application/use-cases/booking/propose-appointment-time.use-case";
import { NullAppointmentNotifier } from "@/application/ports/appointment-notifier";
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

/**
 * Integration tests for the Order / Job Lifecycle module's own use cases
 * (start/complete/cancel/get/list), built on top of the same
 * accepted-quote Job that booking-flows.test.ts covers the creation of.
 * Real use cases + domain services, fake repositories swapped in for
 * storage — same pattern as every other module's integration tests.
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
  return { customerProfiles, professionals, serviceRequests, quotes, quoteAcceptance, appointments, jobs };
}

type Repos = ReturnType<typeof makeRepos>;

async function seedProfessional(repos: Repos, userId: string) {
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
  return {
    start: new StartJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, jobNotifier),
    complete: new CompleteJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, jobNotifier),
    cancel: new CancelJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, jobNotifier),
    get: new GetJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals),
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
  };
}

const CUSTOMER = "user-customer-1";
const PROFESSIONAL = "user-pro-1";
const OTHER_CUSTOMER = "user-customer-2";
const OTHER_PROFESSIONAL = "user-pro-2";

async function confirmTheJobsAppointment(repos: Repos, appointmentId: string) {
  const { propose, confirm } = makeUseCases(repos);
  const { start, end } = future(24);
  await propose.execute(CUSTOMER, appointmentId, start, end);
  await confirm.execute(PROFESSIONAL, appointmentId);
}

describe("Server Action auth boundary (unauthenticated users)", () => {
  it("requireAuth throws (and never resolves a userId) when there is no session", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
    const { requireAuth } = await import("@/infrastructure/auth/rbac");

    await expect(requireAuth()).rejects.toThrow();

    vi.doUnmock("@/lib/auth");
  });
});

describe("Job authorization", () => {
  it("allows both the customer and the professional to view the job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { get } = makeUseCases(repos);

    await expect(get.execute(CUSTOMER, job.id)).resolves.toBeTruthy();
    await expect(get.execute(PROFESSIONAL, job.id)).resolves.toBeTruthy();
  });

  it("rejects an unrelated customer from viewing the job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);
    const { get } = makeUseCases(repos);

    await expect(get.execute(OTHER_CUSTOMER, job.id)).rejects.toThrow();
  });

  it("rejects an unrelated professional from viewing the job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await seedProfessional(repos, OTHER_PROFESSIONAL);
    const { get } = makeUseCases(repos);

    await expect(get.execute(OTHER_PROFESSIONAL, job.id)).rejects.toThrow();
  });

  it("a not-found job id fails the same way for anyone (no existence probing)", async () => {
    const repos = makeRepos();
    await repos.customerProfiles.findOrCreateByUserId(CUSTOMER);
    const { get } = makeUseCases(repos);

    await expect(get.execute(CUSTOMER, "does-not-exist")).rejects.toThrow();
  });

  it("rejects the customer from starting the job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start } = makeUseCases(repos);

    await expect(start.execute(CUSTOMER, job.id)).rejects.toThrow();
  });

  it("rejects the customer from completing the job", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { start, complete, completeAppointment } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    await completeAppointment.execute(PROFESSIONAL, appointment.id);

    await expect(complete.execute(CUSTOMER, job.id)).rejects.toThrow();
  });
});

describe("Start Job", () => {
  it("moves CREATED -> IN_PROGRESS and records who/when", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start } = makeUseCases(repos);

    const started = await start.execute(PROFESSIONAL, job.id);
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.startedByUserId).toBe(PROFESSIONAL);
    expect(started.startedAt).toBeInstanceOf(Date);
  });

  it("rejects starting an already-IN_PROGRESS job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);

    await expect(start.execute(PROFESSIONAL, job.id)).rejects.toThrow();
  });

  it("rejects starting a CANCELLED job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start, cancel } = makeUseCases(repos);
    await cancel.execute(CUSTOMER, job.id, "CUSTOMER_REQUEST", null);

    await expect(start.execute(PROFESSIONAL, job.id)).rejects.toThrow();
  });

  it("only one of two concurrent start attempts can win", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start } = makeUseCases(repos);

    const [a, b] = await Promise.allSettled([start.execute(PROFESSIONAL, job.id), start.execute(PROFESSIONAL, job.id)]);
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
  });
});

describe("Complete Job", () => {
  it("moves IN_PROGRESS -> COMPLETED once every appointment is resolved", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { start, complete, completeAppointment } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    await completeAppointment.execute(PROFESSIONAL, appointment.id);

    const completed = await complete.execute(PROFESSIONAL, job.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedByUserId).toBe(PROFESSIONAL);
    expect(completed.completedAt).toBeInstanceOf(Date);
  });

  it("blocks completion while the job's appointment is still non-terminal", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start, complete, propose } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    // Appointment is only PROPOSED (not yet confirmed/completed) — job
    // completion must be blocked.
    const { start: proposedStart, end } = future(24);
    await propose.execute(CUSTOMER, appointment.id, proposedStart, end);

    await expect(complete.execute(PROFESSIONAL, job.id)).rejects.toThrow();

    // Never silently auto-completed the outstanding appointment either.
    const stillOpen = await repos.appointments.findById(appointment.id);
    expect(stillOpen?.status).toBe("PROPOSED");
  });

  it("rejects completing directly from CREATED — the job must be started first", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { complete, completeAppointment } = makeUseCases(repos);
    await completeAppointment.execute(PROFESSIONAL, appointment.id);

    await expect(complete.execute(PROFESSIONAL, job.id)).rejects.toThrow();
  });

  it("rejects completing an already-COMPLETED job", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { start, complete, completeAppointment } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    await completeAppointment.execute(PROFESSIONAL, appointment.id);
    await complete.execute(PROFESSIONAL, job.id);

    await expect(complete.execute(PROFESSIONAL, job.id)).rejects.toThrow();
  });

  it("rejects completing a CANCELLED job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start, complete, cancel } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    await cancel.execute(PROFESSIONAL, job.id, "PROFESSIONAL_UNABLE_TO_COMPLETE", null);

    await expect(complete.execute(PROFESSIONAL, job.id)).rejects.toThrow();
  });

  it("only one of two concurrent completion attempts can win", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { start, complete, completeAppointment } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    await completeAppointment.execute(PROFESSIONAL, appointment.id);

    const [a, b] = await Promise.allSettled([complete.execute(PROFESSIONAL, job.id), complete.execute(PROFESSIONAL, job.id)]);
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
  });

  it("a complete-vs-cancel race resolves consistently: exactly one terminal write wins, never both", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { start, complete, cancel, completeAppointment } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    await completeAppointment.execute(PROFESSIONAL, appointment.id);

    const [completeResult, cancelResult] = await Promise.allSettled([
      complete.execute(PROFESSIONAL, job.id),
      cancel.execute(CUSTOMER, job.id, "CUSTOMER_REQUEST", null),
    ]);

    const fulfilled = [completeResult, cancelResult].filter((r) => r.status === "fulfilled");
    // IN_PROGRESS is a valid source state for both complete and cancel, so
    // whichever write lands first wins and the other loses the race
    // against the now-terminal status — exactly one succeeds.
    expect(fulfilled).toHaveLength(1);

    const final = await repos.jobs.findById(job.id);
    expect(["COMPLETED", "CANCELLED"]).toContain(final?.status);
  });
});

describe("Cancel Job", () => {
  it("allows the customer to cancel a CREATED job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { cancel } = makeUseCases(repos);

    const cancelled = await cancel.execute(CUSTOMER, job.id, "CUSTOMER_REQUEST", "Changed my mind");
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledByUserId).toBe(CUSTOMER);
    expect(cancelled.cancellationReason).toBe("CUSTOMER_REQUEST");
  });

  it("allows the professional to cancel an IN_PROGRESS job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start, cancel } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);

    const cancelled = await cancel.execute(PROFESSIONAL, job.id, "PROFESSIONAL_UNABLE_TO_COMPLETE", null);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("rejects cancelling an already-CANCELLED job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { cancel } = makeUseCases(repos);
    await cancel.execute(CUSTOMER, job.id, "CUSTOMER_REQUEST", null);

    await expect(cancel.execute(PROFESSIONAL, job.id, "OTHER", null)).rejects.toThrow();
  });

  it("rejects cancelling a COMPLETED job", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { start, complete, cancel, completeAppointment } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    await completeAppointment.execute(PROFESSIONAL, appointment.id);
    await complete.execute(PROFESSIONAL, job.id);

    await expect(cancel.execute(CUSTOMER, job.id, "CUSTOMER_REQUEST", null)).rejects.toThrow();
  });

  it("rejects cancellation from an unrelated user", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);
    const { cancel } = makeUseCases(repos);

    await expect(cancel.execute(OTHER_CUSTOMER, job.id, "OTHER", null)).rejects.toThrow();
  });

  it("a start-vs-cancel race resolves consistently: exactly one write wins", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { start, cancel } = makeUseCases(repos);

    const [startResult, cancelResult] = await Promise.allSettled([
      start.execute(PROFESSIONAL, job.id),
      cancel.execute(CUSTOMER, job.id, "CUSTOMER_REQUEST", null),
    ]);

    const fulfilled = [startResult, cancelResult].filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const final = await repos.jobs.findById(job.id);
    expect(["IN_PROGRESS", "CANCELLED"]).toContain(final?.status);
  });
});

describe("Chat notification behavior", () => {
  it("a chat notification failure never blocks starting a job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const throwingNotifier = { notify: async () => { throw new Error("chat is down"); } };
    const start = new StartJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, throwingNotifier);

    const started = await start.execute(PROFESSIONAL, job.id);
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("a chat notification failure never blocks completing a job", async () => {
    const repos = makeRepos();
    const { job, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { start, completeAppointment } = makeUseCases(repos);
    await start.execute(PROFESSIONAL, job.id);
    await completeAppointment.execute(PROFESSIONAL, appointment.id);
    const throwingNotifier = { notify: async () => { throw new Error("chat is down"); } };
    const complete = new CompleteJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, throwingNotifier);

    const completed = await complete.execute(PROFESSIONAL, job.id);
    expect(completed.status).toBe("COMPLETED");
  });

  it("a chat notification failure never blocks cancelling a job", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const throwingNotifier = { notify: async () => { throw new Error("chat is down"); } };
    const cancel = new CancelJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, throwingNotifier);

    const cancelled = await cancel.execute(CUSTOMER, job.id, "CUSTOMER_REQUEST", null);
    expect(cancelled.status).toBe("CANCELLED");
  });
});

describe("ServiceRequest unaffected by Job lifecycle", () => {
  it("ServiceRequest.status never changes as a side effect of start/complete/cancel Job", async () => {
    const repos = makeRepos();
    const { job, request, appointment } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    await confirmTheJobsAppointment(repos, appointment.id);
    const { start, complete, completeAppointment } = makeUseCases(repos);

    expect((await repos.serviceRequests.findById(request.id))?.status).toBe("ACCEPTED");

    await start.execute(PROFESSIONAL, job.id);
    expect((await repos.serviceRequests.findById(request.id))?.status).toBe("ACCEPTED");

    await completeAppointment.execute(PROFESSIONAL, appointment.id);
    await complete.execute(PROFESSIONAL, job.id);
    // Still ACCEPTED — Module 11 never writes ServiceRequest to IN_PROGRESS
    // or COMPLETED (see the module's audit report, "ServiceRequest
    // Integration").
    expect((await repos.serviceRequests.findById(request.id))?.status).toBe("ACCEPTED");
  });
});
