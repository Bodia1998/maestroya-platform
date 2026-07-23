import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import type {
  AppointmentCancellationReasonValue,
  AppointmentDetailRecord,
  AppointmentRepository,
  AppointmentSummary,
  CancelAppointmentData,
  ListAppointmentsOptions,
  ProposeAppointmentTimeData,
  RescheduleAppointmentData,
  RescheduleAppointmentResult,
} from "@/domain/repositories/appointment-repository";
import type { AppointmentStatusValue } from "@/domain/repositories/quote-acceptance-repository";

const DETAIL_SELECT = {
  id: true,
  quoteId: true,
  serviceRequestId: true,
  addressId: true,
  professionalProfileId: true,
  companyProfileId: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  proposedStart: true,
  proposedEnd: true,
  proposedByUserId: true,
  notes: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancellationReason: true,
  cancellationNote: true,
  rescheduledFromId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaAppointmentDetailRow = {
  id: string;
  quoteId: string;
  serviceRequestId: string;
  addressId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  proposedStart: Date | null;
  proposedEnd: Date | null;
  proposedByUserId: string | null;
  notes: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  cancellationNote: string | null;
  rescheduledFromId: string | null;
  createdAt: Date;
  updatedAt: Date;
  rescheduledTo?: { id: string } | null;
};

function toDetailRecord(row: PrismaAppointmentDetailRow): AppointmentDetailRecord {
  return {
    id: row.id,
    quoteId: row.quoteId,
    serviceRequestId: row.serviceRequestId,
    addressId: row.addressId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    status: row.status as AppointmentStatusValue,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    proposedStart: row.proposedStart,
    proposedEnd: row.proposedEnd,
    proposedByUserId: row.proposedByUserId,
    notes: row.notes,
    cancelledAt: row.cancelledAt,
    cancelledByUserId: row.cancelledByUserId,
    cancellationReason: row.cancellationReason as AppointmentCancellationReasonValue | null,
    cancellationNote: row.cancellationNote,
    rescheduledFromId: row.rescheduledFromId,
    rescheduledToId: row.rescheduledTo?.id ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Non-terminal statuses — see domain/services/appointment-state.ts. Kept
 *  local (rather than importing the domain helper) because this is a pure
 *  Prisma `where` filter concern, not a transition-validity check. */
const NON_TERMINAL: AppointmentStatusValue[] = ["PENDING_SCHEDULE", "PROPOSED", "CONFIRMED"];

// Two separate, statically-typed select/mapper pairs — one per viewer side
// — rather than a single function that builds a `select` object with a
// runtime ternary. A shared function whose `select` shape depends on a
// runtime `counterparty: "professional" | "customer"` parameter has only
// ONE static return type (TypeScript doesn't specialize a function's
// inferred return type per call site), so the two conditionally-spread
// branches get merged into one type where `customer`/`professionalProfile`/
// `companyProfile` are all simultaneously optional — which let a row from
// either branch typecheck against a shape it didn't actually match at
// runtime (this was the mismatch: `serviceRequest.customer` was typed as
// present-with-`user`, but the "professional counterparty" query never
// selects `customer` at all). Two concrete `const` selects avoid the
// merge entirely; each has its own exact literal type.

const CUSTOMER_VIEW_APPOINTMENT_SELECT = {
  id: true,
  serviceRequestId: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  proposedStart: true,
  proposedEnd: true,
  createdAt: true,
  serviceRequest: { select: { title: true } },
  // Shown to the customer as "who's coming" — never selected on the
  // professional-view query below, which has no need for it.
  professionalProfile: { select: { businessName: true, user: { select: { name: true } } } },
  companyProfile: { select: { legalName: true, tradeName: true } },
} as const;

type CustomerViewAppointmentRow = {
  id: string;
  serviceRequestId: string;
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  proposedStart: Date | null;
  proposedEnd: Date | null;
  createdAt: Date;
  serviceRequest: { title: string };
  professionalProfile: { businessName: string | null; user: { name: string | null } } | null;
  companyProfile: { legalName: string; tradeName: string | null } | null;
};

/** Used by listForCustomer — the counterparty to display is the
 *  professional/company on the accepted Quote. */
function toCustomerViewSummary(row: CustomerViewAppointmentRow): AppointmentSummary {
  const counterpartyName =
    row.companyProfile?.tradeName ??
    row.companyProfile?.legalName ??
    row.professionalProfile?.businessName ??
    row.professionalProfile?.user.name ??
    null;

  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    serviceRequestTitle: row.serviceRequest.title,
    status: row.status as AppointmentStatusValue,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    proposedStart: row.proposedStart,
    proposedEnd: row.proposedEnd,
    counterpartyName,
    createdAt: row.createdAt,
  };
}

const PROFESSIONAL_VIEW_APPOINTMENT_SELECT = {
  id: true,
  serviceRequestId: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  proposedStart: true,
  proposedEnd: true,
  createdAt: true,
  // Shown to the professional as "who's the customer" — never selected on
  // the customer-view query above, which has no need for it.
  serviceRequest: { select: { title: true, customer: { select: { user: { select: { name: true } } } } } },
} as const;

type ProfessionalViewAppointmentRow = {
  id: string;
  serviceRequestId: string;
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  proposedStart: Date | null;
  proposedEnd: Date | null;
  createdAt: Date;
  serviceRequest: { title: string; customer: { user: { name: string | null } } };
};

/** Used by listForProfessional — the counterparty to display is the
 *  ServiceRequest's own customer. */
function toProfessionalViewSummary(row: ProfessionalViewAppointmentRow): AppointmentSummary {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    serviceRequestTitle: row.serviceRequest.title,
    status: row.status as AppointmentStatusValue,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    proposedStart: row.proposedStart,
    proposedEnd: row.proposedEnd,
    counterpartyName: row.serviceRequest.customer.user.name ?? null,
    createdAt: row.createdAt,
  };
}

function statusFilter(filter: ListAppointmentsOptions["filter"]) {
  const now = new Date();
  switch (filter) {
    case "upcoming":
      return { status: { in: NON_TERMINAL } };
    case "cancelled":
      return { status: "CANCELLED" as const };
    case "past":
      return {
        OR: [
          { status: "COMPLETED" as const },
          { status: { in: NON_TERMINAL }, scheduledEnd: { lt: now } },
        ],
      };
    default:
      return {};
  }
}

/**
 * Booking & Scheduling module (Module 10): Prisma implementation of the
 * Appointment lifecycle after initial creation. Kept entirely separate
 * from PrismaQuoteAcceptanceRepository (see appointment-repository.ts's
 * doc comment) — this class never creates the *first* Appointment for a
 * Quote, only proposes/confirms/reschedules/cancels/reads ones that
 * already exist.
 */
export class PrismaAppointmentRepository implements AppointmentRepository {
  async findById(id: string): Promise<AppointmentDetailRecord | null> {
    const row = await prisma.appointment.findUnique({
      where: { id },
      select: { ...DETAIL_SELECT, rescheduledTo: { select: { id: true } } },
    });
    return row ? toDetailRecord(row) : null;
  }

  async listForCustomer(customerId: string, options: ListAppointmentsOptions): Promise<AppointmentSummary[]> {
    const rows = await prisma.appointment.findMany({
      where: { serviceRequest: { customerId }, ...statusFilter(options.filter) },
      select: CUSTOMER_VIEW_APPOINTMENT_SELECT,
      orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toCustomerViewSummary);
  }

  async listForProfessional(
    professionalProfileId: string,
    options: ListAppointmentsOptions,
  ): Promise<AppointmentSummary[]> {
    const rows = await prisma.appointment.findMany({
      where: { professionalProfileId, ...statusFilter(options.filter) },
      select: PROFESSIONAL_VIEW_APPOINTMENT_SELECT,
      orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toProfessionalViewSummary);
  }

  async proposeTime(data: ProposeAppointmentTimeData): Promise<AppointmentDetailRecord> {
    const updated = await prisma.appointment.updateMany({
      where: { id: data.appointmentId, status: { in: [...data.expectedStatuses] } },
      data: {
        proposedStart: data.proposedStart,
        proposedEnd: data.proposedEnd,
        proposedByUserId: data.proposedByUserId,
        status: "PROPOSED",
      },
    });
    if (updated.count === 0) {
      throw new ConflictError("This appointment can no longer be proposed for.");
    }
    const row = await prisma.appointment.findUniqueOrThrow({
      where: { id: data.appointmentId },
      select: { ...DETAIL_SELECT, rescheduledTo: { select: { id: true } } },
    });
    return toDetailRecord(row);
  }

  /**
   * Confirms the appointment's currently-proposed time.
   *
   * Three layers of double-booking protection, per the module's audit
   * report ("Recommended scheduling architecture"):
   *   1. Application level — ConfirmAppointmentUseCase's own pre-check
   *      before ever calling this method (not repeated here — the
   *      authoritative check is this method's own, below).
   *   2. Transaction level (this method): everything happens inside one
   *      Prisma interactive transaction. Inside it, this re-reads the
   *      appointment (status + proposed window + professional/company id),
   *      re-verifies it's still PROPOSED, then re-runs the overlap query
   *      for CONFIRMED appointments for the same provider immediately
   *      before writing — closing the exact race window between an
   *      application-level check and the write. The final write is itself
   *      a conditional `updateMany` keyed on id + status still PROPOSED
   *      (same optimistic-concurrency pattern as
   *      PrismaQuoteAcceptanceRepository), so if a *second* concurrent
   *      transaction already confirmed this same appointment (not a
   *      different overlapping one), this one loses the race safely too.
   *   3. Database level — deliberately NOT implemented in this pass. A
   *      Postgres `EXCLUDE USING gist` constraint (requiring the
   *      `btree_gist` extension) on
   *      (professionalProfileId, tstzrange(scheduledStart, scheduledEnd))
   *      WHERE status = 'CONFIRMED' would be the only fully airtight
   *      guarantee against two concurrent transactions that both pass step
   *      2 in the same instant under Postgres's default READ COMMITTED
   *      isolation (two transactions can both read "no conflict" before
   *      either commits). This is explicitly deferred — see the audit's
   *      "CAN BE DEFERRED" section and this migration's own doc comment —
   *      and is a known, documented limitation of this implementation
   *      pass, not an oversight. Until it lands, correctness under
   *      concurrent confirmations depends on Postgres's transaction
   *      isolation behavior for the read-then-conditional-write pattern
   *      used here, which is the same level of protection the existing
   *      quote-acceptance transaction already relies on in production.
   *
   * Half-open interval overlap definition (per the module spec):
   * two appointments [aStart, aEnd) and [bStart, bEnd) overlap iff
   * aStart < bEnd AND aEnd > bStart. Adjacent appointments (10:00–11:00 and
   * 11:00–12:00) do not overlap.
   */
  async confirm(
    appointmentId: string,
    expectedStatuses: readonly AppointmentStatusValue[],
  ): Promise<AppointmentDetailRecord> {
    return prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          status: true,
          proposedStart: true,
          proposedEnd: true,
          professionalProfileId: true,
          companyProfileId: true,
        },
      });
      if (!appointment || !expectedStatuses.includes(appointment.status as AppointmentStatusValue)) {
        throw new ConflictError("This appointment can no longer be confirmed.");
      }
      if (!appointment.proposedStart || !appointment.proposedEnd) {
        throw new ConflictError("No proposed time to confirm.");
      }

      const ownerWhere = appointment.professionalProfileId
        ? { professionalProfileId: appointment.professionalProfileId }
        : { companyProfileId: appointment.companyProfileId };

      // Half-open-interval overlap check against every other CONFIRMED
      // appointment for the same provider — see this method's doc comment.
      const conflict = await tx.appointment.findFirst({
        where: {
          ...ownerWhere,
          id: { not: appointmentId },
          status: "CONFIRMED",
          scheduledStart: { lt: appointment.proposedEnd },
          scheduledEnd: { gt: appointment.proposedStart },
        },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictError(
          "This professional already has a confirmed appointment that overlaps with this time.",
        );
      }

      const updated = await tx.appointment.updateMany({
        where: { id: appointmentId, status: "PROPOSED" },
        data: {
          status: "CONFIRMED",
          scheduledStart: appointment.proposedStart,
          scheduledEnd: appointment.proposedEnd,
        },
      });
      if (updated.count === 0) {
        // Lost a race with a concurrent state change (cancel, another
        // confirm attempt, etc.) between the read above and this write.
        throw new ConflictError("This appointment can no longer be confirmed.");
      }

      const row = await tx.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
        select: { ...DETAIL_SELECT, rescheduledTo: { select: { id: true } } },
      });
      return toDetailRecord(row);
    });
  }

  async cancel(data: CancelAppointmentData): Promise<AppointmentDetailRecord> {
    const updated = await prisma.appointment.updateMany({
      where: { id: data.appointmentId, status: { in: [...data.expectedStatuses] } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: data.cancelledByUserId,
        cancellationReason: data.reason,
        cancellationNote: data.note,
      },
    });
    if (updated.count === 0) {
      throw new ConflictError("This appointment can no longer be cancelled.");
    }
    const row = await prisma.appointment.findUniqueOrThrow({
      where: { id: data.appointmentId },
      select: { ...DETAIL_SELECT, rescheduledTo: { select: { id: true } } },
    });
    return toDetailRecord(row);
  }

  async reschedule(data: RescheduleAppointmentData): Promise<RescheduleAppointmentResult> {
    return prisma.$transaction(async (tx) => {
      const previousUpdate = await tx.appointment.updateMany({
        where: { id: data.appointmentId, status: { in: [...data.expectedStatuses] } },
        data: { status: "RESCHEDULED" },
      });
      if (previousUpdate.count === 0) {
        throw new ConflictError("This appointment can no longer be rescheduled.");
      }

      const previous = await tx.appointment.findUniqueOrThrow({
        where: { id: data.appointmentId },
        select: {
          id: true,
          quoteId: true,
          serviceRequestId: true,
          addressId: true,
          professionalProfileId: true,
          companyProfileId: true,
        },
      });

      const next = await tx.appointment.create({
        data: {
          quoteId: previous.quoteId,
          serviceRequestId: previous.serviceRequestId,
          addressId: previous.addressId,
          professionalProfileId: previous.professionalProfileId,
          companyProfileId: previous.companyProfileId,
          status: "PROPOSED",
          proposedStart: data.proposedStart,
          proposedEnd: data.proposedEnd,
          proposedByUserId: data.proposedByUserId,
          rescheduledFromId: previous.id,
        },
        select: { ...DETAIL_SELECT, rescheduledTo: { select: { id: true } } },
      });

      const previousDetail = await tx.appointment.findUniqueOrThrow({
        where: { id: previous.id },
        select: { ...DETAIL_SELECT, rescheduledTo: { select: { id: true } } },
      });

      return { previous: toDetailRecord(previousDetail), next: toDetailRecord(next) };
    });
  }
}
