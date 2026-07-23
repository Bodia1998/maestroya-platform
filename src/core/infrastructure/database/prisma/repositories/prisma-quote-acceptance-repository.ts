import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import { OPEN_QUOTE_STATUSES } from "@/domain/services/quote-state";
import type {
  AcceptQuoteJobRecord,
  AcceptQuoteResult,
  AppointmentRecord,
  AppointmentStatusValue,
  QuoteAcceptanceRepository,
} from "@/domain/repositories/quote-acceptance-repository";

const APPOINTMENT_SELECT = {
  id: true,
  jobId: true,
  quoteId: true,
  serviceRequestId: true,
  addressId: true,
  professionalProfileId: true,
  companyProfileId: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaAppointmentRow = {
  id: string;
  jobId: string;
  quoteId: string;
  serviceRequestId: string;
  addressId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toAppointmentRecord(row: PrismaAppointmentRow): AppointmentRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    quoteId: row.quoteId,
    serviceRequestId: row.serviceRequestId,
    addressId: row.addressId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    status: row.status as AppointmentStatusValue,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const JOB_SELECT = {
  id: true,
  serviceRequestId: true,
  quoteId: true,
  customerId: true,
  professionalProfileId: true,
  companyProfileId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaJobRow = {
  id: string;
  serviceRequestId: string;
  quoteId: string;
  customerId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function toAcceptQuoteJobRecord(row: PrismaJobRow): AcceptQuoteJobRecord {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    quoteId: row.quoteId,
    customerId: row.customerId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    status: "CREATED",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaQuoteAcceptanceRepository implements QuoteAcceptanceRepository {
  async acceptQuote({
    quoteId,
    serviceRequestId,
  }: {
    quoteId: string;
    serviceRequestId: string;
  }): Promise<AcceptQuoteResult> {
    return prisma.$transaction(async (tx) => {
      // Fetched inside the transaction (not via ServiceRequestRepository)
      // so this stays a single round-trip that also re-verifies status —
      // this call is the last line of defense against a race with another
      // acceptance attempt, not just a read.
      const request = await tx.serviceRequest.findFirst({
        where: { id: serviceRequestId, deletedAt: null },
        select: { id: true, addressId: true, status: true, customerId: true },
      });
      if (!request) {
        throw new NotFoundError("ServiceRequest", serviceRequestId);
      }
      if (request.status !== "PUBLISHED") {
        throw new ConflictError("This request can no longer accept a quote.");
      }

      // Conditioned on id + serviceRequestId + still-open status in one
      // atomic updateMany — if a concurrent transaction already accepted
      // (or otherwise changed) this quote, `count` comes back 0 and this
      // whole transaction rolls back rather than proceeding.
      const acceptedUpdate = await tx.quote.updateMany({
        where: {
          id: quoteId,
          serviceRequestId,
          status: { in: [...OPEN_QUOTE_STATUSES] },
        },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      if (acceptedUpdate.count === 0) {
        throw new ConflictError("This quote can no longer be accepted.");
      }

      // Booking & Scheduling module (Module 10): the Appointment created
      // below denormalizes the accepted Quote's own provider — read inside
      // the same transaction (not via QuoteRepository) so this stays one
      // round-trip and can never observe a different quote than the one
      // just accepted above.
      const acceptedQuote = await tx.quote.findUniqueOrThrow({
        where: { id: quoteId },
        select: { professionalProfileId: true, companyProfileId: true },
      });

      // Every other still-open quote on the same request is rejected.
      // WITHDRAWN/EXPIRED/already-terminal quotes are excluded by the same
      // status filter and are left untouched.
      await tx.quote.updateMany({
        where: {
          serviceRequestId,
          status: { in: [...OPEN_QUOTE_STATUSES] },
          NOT: { id: quoteId },
        },
        data: { status: "REJECTED", respondedAt: new Date() },
      });

      const requestUpdate = await tx.serviceRequest.updateMany({
        where: { id: serviceRequestId, status: "PUBLISHED" },
        data: { status: "ACCEPTED" },
      });
      if (requestUpdate.count === 0) {
        throw new ConflictError("This request can no longer accept a quote.");
      }

      // Order / Job Lifecycle module (Module 11): exactly one Job per
      // accepted Quote — status CREATED, denormalizing
      // serviceRequestId/customerId/professionalProfileId/companyProfileId
      // the same way the Appointment created below denormalizes its own
      // ownership. `Job.quoteId` is unique, so a second Job for this same
      // Quote is impossible at the database level; the conditional
      // updateMany above already ensures no concurrent transaction can
      // reach this point twice for the same Quote.
      const job = await tx.job.create({
        data: {
          serviceRequestId,
          quoteId,
          customerId: request.customerId,
          professionalProfileId: acceptedQuote.professionalProfileId,
          companyProfileId: acceptedQuote.companyProfileId,
          status: "CREATED",
        },
        select: JOB_SELECT,
      });

      // Exactly one Appointment per accepted Quote/ServiceRequest — status
      // PENDING_SCHEDULE, scheduledStart left null. No scheduling,
      // availability, or conflict-detection logic here; see this module's
      // scope note and schema.prisma's Appointment doc comment.
      const appointment = await tx.appointment.create({
        data: {
          jobId: job.id,
          quoteId,
          serviceRequestId,
          addressId: request.addressId,
          // Booking & Scheduling module (Module 10): denormalized 1:1 from
          // the accepted Quote's own ownership — never independently
          // chosen here. Exactly one of these is non-null because exactly
          // one is non-null on the Quote itself (enforced by
          // quotes_provider_xor_check), so appointments_provider_xor_check
          // is satisfied by construction.
          professionalProfileId: acceptedQuote.professionalProfileId,
          companyProfileId: acceptedQuote.companyProfileId,
          status: "PENDING_SCHEDULE",
          scheduledStart: null,
        },
        select: APPOINTMENT_SELECT,
      });

      return {
        serviceRequestId,
        acceptedQuoteId: quoteId,
        job: toAcceptQuoteJobRecord(job),
        appointment: toAppointmentRecord(appointment),
      };
    });
  }
}
