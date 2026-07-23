import { describe, expect, it } from "vitest";

import { NullAppointmentNotifier } from "@/application/ports/appointment-notifier";
import { CancelAppointmentUseCase } from "@/application/use-cases/booking/cancel-appointment.use-case";
import { CompleteAppointmentUseCase } from "@/application/use-cases/booking/complete-appointment.use-case";
import { ConfirmAppointmentUseCase } from "@/application/use-cases/booking/confirm-appointment.use-case";
import { GetAppointmentUseCase } from "@/application/use-cases/booking/get-appointment.use-case";
import { ProposeAppointmentTimeUseCase } from "@/application/use-cases/booking/propose-appointment-time.use-case";
import { RescheduleAppointmentUseCase } from "@/application/use-cases/booking/reschedule-appointment.use-case";
import type { ServiceRequestRecord, ServiceRequestStatusValue } from "@/domain/repositories/service-request-repository";
import type { QuoteStatusValue } from "@/domain/repositories/quote-repository";
import {
  FakeAppointmentRepository,
  FakeCustomerProfileRepository,
  FakeQuoteAcceptanceRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
  createAppointmentStore,
} from "./fakes";
import { FakeProfessionalRepository } from "../quotes/fakes";

/**
 * Integration tests for the Booking & Scheduling module's post-creation
 * lifecycle (propose -> confirm -> cancel/reschedule), built on top of the
 * same accepted-quote Appointment that booking-flows.test.ts already
 * covers the creation of. Real use cases + domain services, fake
 * repositories swapped in for storage — same pattern as every other
 * module's integration tests in this repo.
 */

let counter = 0;

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const store = createAppointmentStore();
  const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests, store);
  const appointments = new FakeAppointmentRepository(store);
  return { customerProfiles, professionals, serviceRequests, quotes, quoteAcceptance, appointments };
}

type Repos = ReturnType<typeof makeRepos>;

async function seedProfessional(repos: Repos, userId: string) {
  return repos.professionals.create(userId, {});
}

async function seedRequest(
  repos: Repos,
  customerUserId: string,
  status: ServiceRequestStatusValue = "PUBLISHED",
): Promise<ServiceRequestRecord> {
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
    status,
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

async function seedAcceptedAppointment(
  repos: Repos,
  customerUserId: string,
  professionalUserId: string,
  quoteStatus: QuoteStatusValue = "SENT",
) {
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
  if (quoteStatus !== "SENT") {
    await repos.quotes.updateStatus(quote.id, quoteStatus);
  }
  const result = await repos.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id });
  return { request, professional, appointment: result.appointment };
}

function future(hoursFromNow: number, durationMinutes = 60) {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return { start, end };
}

function makeUseCases(repos: Repos) {
  const notifier = new NullAppointmentNotifier();
  const deps = [repos.appointments, repos.customerProfiles, repos.professionals, repos.serviceRequests] as const;
  return {
    propose: new ProposeAppointmentTimeUseCase(...deps, notifier),
    confirm: new ConfirmAppointmentUseCase(...deps, notifier),
    cancel: new CancelAppointmentUseCase(...deps, notifier),
    complete: new CompleteAppointmentUseCase(...deps, notifier),
    reschedule: new RescheduleAppointmentUseCase(...deps, notifier),
    get: new GetAppointmentUseCase(repos.appointments, repos.customerProfiles, repos.professionals, repos.serviceRequests),
  };
}

const CUSTOMER = "user-customer-1";
const PROFESSIONAL = "user-pro-1";
const OTHER_CUSTOMER = "user-customer-2";
const OTHER_PROFESSIONAL = "user-pro-2";

describe("Appointment authorization", () => {
  it("rejects an unrelated customer from viewing the appointment", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);
    const { get } = makeUseCases(repos);

    await expect(get.execute(OTHER_CUSTOMER, appointment.id)).rejects.toThrow();
  });

  it("rejects an unrelated professional from viewing the appointment", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    await seedProfessional(repos, OTHER_PROFESSIONAL);
    const { get } = makeUseCases(repos);

    await expect(get.execute(OTHER_PROFESSIONAL, appointment.id)).rejects.toThrow();
  });

  it("rejects proposing a time on an appointment the caller has no relationship to", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    await seedProfessional(repos, OTHER_PROFESSIONAL);
    const { propose } = makeUseCases(repos);
    const { start, end } = future(24);

    await expect(propose.execute(OTHER_PROFESSIONAL, appointment.id, start, end)).rejects.toThrow();
  });

  it("allows both the customer and the professional to view the appointment", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { get } = makeUseCases(repos);

    await expect(get.execute(CUSTOMER, appointment.id)).resolves.toBeTruthy();
    await expect(get.execute(PROFESSIONAL, appointment.id)).resolves.toBeTruthy();
  });

  it("a not-found appointment id fails the same way for anyone (no existence probing)", async () => {
    const repos = makeRepos();
    const { get } = makeUseCases(repos);
    await repos.customerProfiles.findOrCreateByUserId(CUSTOMER);

    await expect(get.execute(CUSTOMER, "does-not-exist")).rejects.toThrow();
  });
});

describe("Propose -> Confirm state machine", () => {
  it("moves PENDING_SCHEDULE -> PROPOSED -> CONFIRMED via the correct pair of actors", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm } = makeUseCases(repos);
    const { start, end } = future(24);

    const proposed = await propose.execute(CUSTOMER, appointment.id, start, end);
    expect(proposed.status).toBe("PROPOSED");
    expect(proposed.proposedByUserId).toBe(CUSTOMER);

    const confirmed = await confirm.execute(PROFESSIONAL, appointment.id);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.scheduledStart?.getTime()).toBe(start.getTime());
    expect(confirmed.scheduledEnd?.getTime()).toBe(end.getTime());
  });

  it("rejects the proposer confirming their own proposal", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm } = makeUseCases(repos);
    const { start, end } = future(24);

    await propose.execute(CUSTOMER, appointment.id, start, end);

    await expect(confirm.execute(CUSTOMER, appointment.id)).rejects.toThrow();
  });

  it("allows a counter-proposal (PROPOSED -> PROPOSED)", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose } = makeUseCases(repos);
    const first = future(24);
    const second = future(48);

    await propose.execute(CUSTOMER, appointment.id, first.start, first.end);
    const counterProposed = await propose.execute(PROFESSIONAL, appointment.id, second.start, second.end);

    expect(counterProposed.status).toBe("PROPOSED");
    expect(counterProposed.proposedByUserId).toBe(PROFESSIONAL);
    expect(counterProposed.proposedStart?.getTime()).toBe(second.start.getTime());
  });

  it("rejects confirming when there is nothing proposed yet", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { confirm } = makeUseCases(repos);

    await expect(confirm.execute(PROFESSIONAL, appointment.id)).rejects.toThrow();
  });

  it("rejects confirming an already-CONFIRMED appointment a second time", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm } = makeUseCases(repos);
    const { start, end } = future(24);

    await propose.execute(CUSTOMER, appointment.id, start, end);
    await confirm.execute(PROFESSIONAL, appointment.id);

    await expect(confirm.execute(CUSTOMER, appointment.id)).rejects.toThrow();
  });
});

describe("Scheduling validity rules", () => {
  it("rejects end <= start", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose } = makeUseCases(repos);
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() - 60 * 1000);

    await expect(propose.execute(CUSTOMER, appointment.id, start, end)).rejects.toThrow();
  });

  it("rejects a proposal in the past", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose } = makeUseCases(repos);
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 60 * 1000);

    await expect(propose.execute(CUSTOMER, appointment.id, start, end)).rejects.toThrow();
  });

  it("rejects a proposal with less than the minimum notice", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose } = makeUseCases(repos);
    const { start, end } = future(0.5); // 30 minutes from now — below the 2h minimum

    await expect(propose.execute(CUSTOMER, appointment.id, start, end)).rejects.toThrow();
  });

  it("rejects an unreasonably long appointment", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose } = makeUseCases(repos);
    const { start } = future(24);
    const end = new Date(start.getTime() + 13 * 60 * 60 * 1000); // 13h, over the 12h max

    await expect(propose.execute(CUSTOMER, appointment.id, start, end)).rejects.toThrow();
  });
});

describe("Double-booking / conflict detection", () => {
  it("rejects confirming an appointment that overlaps an existing CONFIRMED appointment for the same professional", async () => {
    const repos = makeRepos();
    const professional = await seedProfessional(repos, PROFESSIONAL);

    // First job: 10:00-12:00 (relative offsets), confirmed.
    const requestA = await seedRequest(repos, CUSTOMER);
    const quoteA = await repos.quotes.create({
      serviceRequestId: requestA.id,
      professionalProfileId: professional.id,
      submittedByUserId: PROFESSIONAL,
      totalAmount: 100,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
    });
    const resultA = await repos.quoteAcceptance.acceptQuote({ quoteId: quoteA.id, serviceRequestId: requestA.id });
    const { propose, confirm } = makeUseCases(repos);
    const windowA = future(24, 120);
    await propose.execute(CUSTOMER, resultA.appointment.id, windowA.start, windowA.end);
    await confirm.execute(PROFESSIONAL, resultA.appointment.id);

    // Second job for a different customer, same professional, overlapping window.
    const customerB = "user-customer-b";
    const requestB = await seedRequest(repos, customerB);
    const quoteB = await repos.quotes.create({
      serviceRequestId: requestB.id,
      professionalProfileId: professional.id,
      submittedByUserId: PROFESSIONAL,
      totalAmount: 100,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
    });
    const resultB = await repos.quoteAcceptance.acceptQuote({ quoteId: quoteB.id, serviceRequestId: requestB.id });
    const overlapping = {
      start: new Date(windowA.start.getTime() + 30 * 60 * 1000), // starts 30min into A's window
      end: new Date(windowA.end.getTime() + 30 * 60 * 1000),
    };
    await propose.execute(customerB, resultB.appointment.id, overlapping.start, overlapping.end);

    await expect(confirm.execute(PROFESSIONAL, resultB.appointment.id)).rejects.toThrow();
  });

  it("allows adjacent (back-to-back, non-overlapping) confirmed appointments for the same professional", async () => {
    const repos = makeRepos();
    const professional = await seedProfessional(repos, PROFESSIONAL);
    const { propose, confirm } = makeUseCases(repos);

    const requestA = await seedRequest(repos, CUSTOMER);
    const quoteA = await repos.quotes.create({
      serviceRequestId: requestA.id,
      professionalProfileId: professional.id,
      submittedByUserId: PROFESSIONAL,
      totalAmount: 100,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
    });
    const resultA = await repos.quoteAcceptance.acceptQuote({ quoteId: quoteA.id, serviceRequestId: requestA.id });
    const windowA = future(24, 60); // e.g. 10:00-11:00
    await propose.execute(CUSTOMER, resultA.appointment.id, windowA.start, windowA.end);
    await confirm.execute(PROFESSIONAL, resultA.appointment.id);

    const customerB = "user-customer-b";
    const requestB = await seedRequest(repos, customerB);
    const quoteB = await repos.quotes.create({
      serviceRequestId: requestB.id,
      professionalProfileId: professional.id,
      submittedByUserId: PROFESSIONAL,
      totalAmount: 100,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
    });
    const resultB = await repos.quoteAcceptance.acceptQuote({ quoteId: quoteB.id, serviceRequestId: requestB.id });
    // Back-to-back: starts exactly when A ends — 11:00-12:00.
    const windowB = { start: windowA.end, end: new Date(windowA.end.getTime() + 60 * 60 * 1000) };
    await propose.execute(customerB, resultB.appointment.id, windowB.start, windowB.end);

    await expect(confirm.execute(PROFESSIONAL, resultB.appointment.id)).resolves.toMatchObject({
      status: "CONFIRMED",
    });
  });

  it("allows two different professionals to have overlapping confirmed appointments", async () => {
    const repos = makeRepos();
    const { propose, confirm } = makeUseCases(repos);

    const { appointment: appointmentA } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const windowA = future(24, 60);
    await propose.execute(CUSTOMER, appointmentA.id, windowA.start, windowA.end);
    await confirm.execute(PROFESSIONAL, appointmentA.id);

    const { appointment: appointmentB } = await seedAcceptedAppointment(repos, "user-customer-c", OTHER_PROFESSIONAL);
    // Same exact window, different professional — must be allowed.
    await propose.execute("user-customer-c", appointmentB.id, windowA.start, windowA.end);

    await expect(confirm.execute(OTHER_PROFESSIONAL, appointmentB.id)).resolves.toMatchObject({
      status: "CONFIRMED",
    });
  });
});

describe("Concurrency", () => {
  it("only one of two concurrent confirmations on overlapping appointments for the same professional can win", async () => {
    const repos = makeRepos();
    const professional = await seedProfessional(repos, PROFESSIONAL);
    const { propose, confirm } = makeUseCases(repos);

    const requestA = await seedRequest(repos, CUSTOMER);
    const quoteA = await repos.quotes.create({
      serviceRequestId: requestA.id,
      professionalProfileId: professional.id,
      submittedByUserId: PROFESSIONAL,
      totalAmount: 100,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
    });
    const resultA = await repos.quoteAcceptance.acceptQuote({ quoteId: quoteA.id, serviceRequestId: requestA.id });

    const customerB = "user-customer-b";
    const requestB = await seedRequest(repos, customerB);
    const quoteB = await repos.quotes.create({
      serviceRequestId: requestB.id,
      professionalProfileId: professional.id,
      submittedByUserId: PROFESSIONAL,
      totalAmount: 100,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
    });
    const resultB = await repos.quoteAcceptance.acceptQuote({ quoteId: quoteB.id, serviceRequestId: requestB.id });

    const window = future(24, 60);
    await propose.execute(CUSTOMER, resultA.appointment.id, window.start, window.end);
    await propose.execute(customerB, resultB.appointment.id, window.start, window.end);

    // "Concurrent" here means issued without awaiting between them — the
    // fake repository has no real DB transaction to interleave against,
    // but this still proves the conflict check + conditional write
    // together prevent both from ending up CONFIRMED, which is the
    // invariant that matters. A real-Postgres concurrency test for this
    // exact race is a documented limitation of this test suite — see the
    // module's final report.
    const [settledA, settledB] = await Promise.allSettled([
      confirm.execute(PROFESSIONAL, resultA.appointment.id),
      confirm.execute(PROFESSIONAL, resultB.appointment.id),
    ]);

    const outcomes = [settledA, settledB];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("a confirm-vs-cancel race always converges on CANCELLED, with no corrupted intermediate state", async () => {
    // Unlike the two tests above, confirm and cancel are NOT racing for the
    // same source state: CancelAppointmentUseCase's precondition is "any
    // non-terminal status" (PENDING_SCHEDULE, PROPOSED, *or* CONFIRMED —
    // see NON_TERMINAL_STATUSES and its own doc comment: a CONFIRMED
    // appointment must remain cancellable, e.g. for last-minute changes).
    // So cancel can validly consume either the pre-confirm (PROPOSED) or
    // post-confirm (CONFIRMED) state, while confirm can only validly
    // consume PROPOSED. That makes exactly two legal interleavings, both
    // ending in the same final status:
    //   1. cancel's write lands first: PROPOSED -> CANCELLED. confirm's own
    //      write then re-reads CANCELLED (not PROPOSED) and is correctly
    //      rejected by the same compare-and-set guard proven in the
    //      confirm-vs-confirm race above.
    //   2. confirm's write lands first: PROPOSED -> CONFIRMED, and cancel's
    //      write then re-reads CONFIRMED, which is still a legal starting
    //      state for it, so it succeeds: CONFIRMED -> CANCELLED.
    // In both cases cancel succeeds and the appointment ends CANCELLED;
    // confirm's own success is interleaving-dependent, but it can never
    // itself land on an invalid transition, and the appointment can never
    // end up anywhere other than CANCELLED, mutated by anyone other than
    // the actual canceller, or missing cancellation metadata — that is the
    // guarantee this test asserts, replacing an earlier, incorrect
    // "exactly one of confirm/cancel may ever succeed" assertion that
    // implicitly assumed cancelling a CONFIRMED appointment should be
    // impossible, which contradicts this module's actual cancellation
    // rules.
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm, cancel } = makeUseCases(repos);
    const { start, end } = future(24);
    await propose.execute(CUSTOMER, appointment.id, start, end);

    const [confirmResult, cancelResult] = await Promise.allSettled([
      confirm.execute(PROFESSIONAL, appointment.id),
      cancel.execute(CUSTOMER, appointment.id, "CUSTOMER_REQUEST", null),
    ]);

    // Cancel's precondition is satisfied no matter which write lands
    // first, so it must always succeed.
    expect(cancelResult.status).toBe("fulfilled");

    // Confirm either wins the race (fulfilled, appointment briefly
    // CONFIRMED before being cancelled) or loses it cleanly with a real
    // thrown error (never silently swallowed, never a corrupted partial
    // write) — both are valid outcomes of this interleaving, but nothing
    // else is.
    if (confirmResult.status === "rejected") {
      expect(confirmResult.reason).toBeInstanceOf(Error);
    }

    // Whichever interleaving occurred, exactly one terminal state is ever
    // reachable here, and it must be fully, consistently written — not a
    // status flip with stale/missing cancellation metadata.
    const final = await repos.appointments.findById(appointment.id);
    expect(final?.status).toBe("CANCELLED");
    expect(final?.cancelledByUserId).toBe(CUSTOMER);
    expect(final?.cancellationReason).toBe("CUSTOMER_REQUEST");
  });
});

describe("Cancellation", () => {
  it("allows the customer to cancel a PENDING_SCHEDULE appointment", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { cancel } = makeUseCases(repos);

    const cancelled = await cancel.execute(CUSTOMER, appointment.id, "CUSTOMER_REQUEST", "Change of plans");
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledByUserId).toBe(CUSTOMER);
    expect(cancelled.cancellationReason).toBe("CUSTOMER_REQUEST");
  });

  it("allows the professional to cancel a CONFIRMED appointment", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm, cancel } = makeUseCases(repos);
    const { start, end } = future(24);
    await propose.execute(CUSTOMER, appointment.id, start, end);
    await confirm.execute(PROFESSIONAL, appointment.id);

    const cancelled = await cancel.execute(PROFESSIONAL, appointment.id, "PROFESSIONAL_UNAVAILABLE", null);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("rejects cancelling an already-cancelled (terminal) appointment", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { cancel } = makeUseCases(repos);
    await cancel.execute(CUSTOMER, appointment.id, "CUSTOMER_REQUEST", null);

    await expect(cancel.execute(PROFESSIONAL, appointment.id, "OTHER", null)).rejects.toThrow();
  });

  it("rejects cancellation from an unrelated user", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { cancel } = makeUseCases(repos);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);

    await expect(cancel.execute(OTHER_CUSTOMER, appointment.id, "OTHER", null)).rejects.toThrow();
  });
});

describe("Rescheduling", () => {
  it("supersedes a CONFIRMED appointment with a new linked PROPOSED appointment, preserving the old row", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm, reschedule } = makeUseCases(repos);
    const original = future(24);
    await propose.execute(CUSTOMER, appointment.id, original.start, original.end);
    await confirm.execute(PROFESSIONAL, appointment.id);

    const newWindow = future(48);
    const result = await reschedule.execute(CUSTOMER, appointment.id, newWindow.start, newWindow.end);

    expect(result.previous.status).toBe("RESCHEDULED");
    // Original confirmed time is preserved on the old row — not overwritten.
    expect(result.previous.scheduledStart?.getTime()).toBe(original.start.getTime());
    expect(result.next.status).toBe("PROPOSED");
    expect(result.next.rescheduledFromId).toBe(appointment.id);
    expect(result.next.proposedStart?.getTime()).toBe(newWindow.start.getTime());

    // The new appointment still requires confirmation — rescheduling never
    // bypasses the conflict-checked confirm path.
    expect(result.next.scheduledStart).toBeNull();
  });

  it("rejects rescheduling a PENDING_SCHEDULE appointment (nothing to move yet)", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { reschedule } = makeUseCases(repos);
    const { start, end } = future(24);

    await expect(reschedule.execute(CUSTOMER, appointment.id, start, end)).rejects.toThrow();
  });

  it("rejects rescheduling a terminal (cancelled) appointment", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm, cancel, reschedule } = makeUseCases(repos);
    const original = future(24);
    await propose.execute(CUSTOMER, appointment.id, original.start, original.end);
    await confirm.execute(PROFESSIONAL, appointment.id);
    await cancel.execute(CUSTOMER, appointment.id, "CUSTOMER_REQUEST", null);

    const newWindow = future(48);
    await expect(reschedule.execute(CUSTOMER, appointment.id, newWindow.start, newWindow.end)).rejects.toThrow();
  });

  it("rejects an unrelated user from requesting a reschedule", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm, reschedule } = makeUseCases(repos);
    const original = future(24);
    await propose.execute(CUSTOMER, appointment.id, original.start, original.end);
    await confirm.execute(PROFESSIONAL, appointment.id);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);

    const newWindow = future(48);
    await expect(
      reschedule.execute(OTHER_CUSTOMER, appointment.id, newWindow.start, newWindow.end),
    ).rejects.toThrow();
  });

  it("two concurrent reschedule requests on the same appointment: only one wins", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm, reschedule } = makeUseCases(repos);
    const original = future(24);
    await propose.execute(CUSTOMER, appointment.id, original.start, original.end);
    await confirm.execute(PROFESSIONAL, appointment.id);

    const windowA = future(48);
    const windowB = future(72);
    const [a, b] = await Promise.allSettled([
      reschedule.execute(CUSTOMER, appointment.id, windowA.start, windowA.end),
      reschedule.execute(PROFESSIONAL, appointment.id, windowB.start, windowB.end),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
  });
});

describe("Quote/Appointment consistency", () => {
  it("the Appointment's professionalProfileId always matches the accepted Quote's professional", async () => {
    const repos = makeRepos();
    const { appointment, professional } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    expect(appointment.professionalProfileId).toBe(professional.id);
  });

  it("the Appointment's serviceRequestId always matches the request the accepted quote was for", async () => {
    const repos = makeRepos();
    const { appointment, request } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    expect(appointment.serviceRequestId).toBe(request.id);
  });
});

// Order / Job Lifecycle module (Module 11).
describe("Appointment completion (CONFIRMED -> COMPLETED)", () => {
  async function seedConfirmedAppointment(repos: Repos) {
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm } = makeUseCases(repos);
    const { start, end } = future(24);
    await propose.execute(CUSTOMER, appointment.id, start, end);
    await confirm.execute(PROFESSIONAL, appointment.id);
    return appointment;
  }

  it("allows the professional to mark a CONFIRMED appointment completed", async () => {
    const repos = makeRepos();
    const appointment = await seedConfirmedAppointment(repos);
    const { complete } = makeUseCases(repos);

    const completed = await complete.execute(PROFESSIONAL, appointment.id);
    expect(completed.status).toBe("COMPLETED");
  });

  it("allows the customer to mark a CONFIRMED appointment completed", async () => {
    const repos = makeRepos();
    const appointment = await seedConfirmedAppointment(repos);
    const { complete } = makeUseCases(repos);

    const completed = await complete.execute(CUSTOMER, appointment.id);
    expect(completed.status).toBe("COMPLETED");
  });

  it.each(["PENDING_SCHEDULE", "PROPOSED", "CANCELLED", "COMPLETED"] as const)(
    "rejects completing from %s",
    async (statusToReach) => {
      const repos = makeRepos();
      const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
      const { propose, confirm, cancel, complete } = makeUseCases(repos);

      if (statusToReach === "PROPOSED") {
        const { start, end } = future(24);
        await propose.execute(CUSTOMER, appointment.id, start, end);
      } else if (statusToReach === "CANCELLED") {
        await cancel.execute(CUSTOMER, appointment.id, "CUSTOMER_REQUEST", null);
      } else if (statusToReach === "COMPLETED") {
        const { start, end } = future(24);
        await propose.execute(CUSTOMER, appointment.id, start, end);
        await confirm.execute(PROFESSIONAL, appointment.id);
        await complete.execute(PROFESSIONAL, appointment.id);
      }

      await expect(complete.execute(PROFESSIONAL, appointment.id)).rejects.toThrow();
    },
  );

  it("rejects completion from an unrelated user", async () => {
    const repos = makeRepos();
    const appointment = await seedConfirmedAppointment(repos);
    const { complete } = makeUseCases(repos);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);

    await expect(complete.execute(OTHER_CUSTOMER, appointment.id)).rejects.toThrow();
  });

  it("only one of two concurrent completion attempts can win", async () => {
    const repos = makeRepos();
    const appointment = await seedConfirmedAppointment(repos);
    const { complete } = makeUseCases(repos);

    const [a, b] = await Promise.allSettled([
      complete.execute(PROFESSIONAL, appointment.id),
      complete.execute(CUSTOMER, appointment.id),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
  });

  it("a chat notification failure never blocks appointment completion", async () => {
    const repos = makeRepos();
    const appointment = await seedConfirmedAppointment(repos);
    const throwingNotifier = { notify: async () => { throw new Error("chat is down"); } };
    const completeWithThrowingNotifier = new CompleteAppointmentUseCase(
      repos.appointments,
      repos.customerProfiles,
      repos.professionals,
      repos.serviceRequests,
      throwingNotifier,
    );

    const completed = await completeWithThrowingNotifier.execute(PROFESSIONAL, appointment.id);
    expect(completed.status).toBe("COMPLETED");
  });
});

describe("Job/Appointment consistency", () => {
  it("the initial Appointment created by quote acceptance is linked to the Job created in the same transaction", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    expect(appointment.jobId).toBeTruthy();
    expect(repos.quoteAcceptance.jobs.get(appointment.jobId)).toBeTruthy();
  });

  it("a rescheduled appointment's new row carries the same jobId as the row it supersedes", async () => {
    const repos = makeRepos();
    const { appointment } = await seedAcceptedAppointment(repos, CUSTOMER, PROFESSIONAL);
    const { propose, confirm, reschedule } = makeUseCases(repos);
    const original = future(24);
    await propose.execute(CUSTOMER, appointment.id, original.start, original.end);
    await confirm.execute(PROFESSIONAL, appointment.id);

    const newWindow = future(48);
    const result = await reschedule.execute(CUSTOMER, appointment.id, newWindow.start, newWindow.end);

    expect(result.previous.jobId).toBe(appointment.jobId);
    expect(result.next.jobId).toBe(appointment.jobId);
  });
});
