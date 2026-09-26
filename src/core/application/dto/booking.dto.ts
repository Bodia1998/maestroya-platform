import { z } from "zod";

/**
 * Booking & Scheduling module (Module 10). Same convention as
 * quote.dto.ts/chat.dto.ts: one schema shared by the client form (via
 * @hookform/resolvers/zod) and the Server Action that receives it.
 *
 * Deliberately absent from every schema here: `userId`, `customerId`,
 * `professionalProfileId`, `companyProfileId` — ownership is always
 * derived from the authenticated session (see resolveAppointmentActor and
 * every booking use case's own doc comment), never accepted as client
 * input even if a form field could technically carry it.
 *
 * `appointmentId` itself *is* accepted here (and re-verified server-side
 * against the caller's session by every use case) — same as
 * `conversationId` in chat.dto.ts: it identifies which resource the action
 * targets, not a claim of ownership over it.
 */

/** Shared by propose and reschedule — both need exactly a validated
 *  `[start, end)` window; spread into each full schema below rather than
 *  duplicated field-by-field. The `end > start` invariant is re-applied
 *  via `.refine()` on each full schema (Zod doesn't preserve `.refine()`
 *  across `.extend()`, so it's re-declared, not re-implemented). */
const timeWindowFields = {
  start: z.coerce.date({ invalid_type_error: "dto.booking.startTimeInvalid" }),
  end: z.coerce.date({ invalid_type_error: "dto.booking.endTimeInvalid" }),
};

function withEndAfterStart<T extends { start: Date; end: Date }>(schema: z.ZodType<T>) {
  return schema.refine((data) => data.end.getTime() > data.start.getTime(), {
    message: "dto.booking.endAfterStart",
    path: ["end"],
  });
}

export const proposeAppointmentTimeSchema = withEndAfterStart(
  z.object({
    appointmentId: z.string().uuid("dto.ids.appointment"),
    ...timeWindowFields,
  }),
);
export type ProposeAppointmentTimeInput = z.infer<typeof proposeAppointmentTimeSchema>;

export const confirmAppointmentSchema = z.object({
  appointmentId: z.string().uuid("dto.ids.appointment"),
});
export type ConfirmAppointmentInput = z.infer<typeof confirmAppointmentSchema>;

export const rescheduleAppointmentSchema = withEndAfterStart(
  z.object({
    appointmentId: z.string().uuid("dto.ids.appointment"),
    ...timeWindowFields,
  }),
);
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const MAX_CANCELLATION_NOTE_LENGTH = 1000;

export const cancelAppointmentSchema = z.object({
  appointmentId: z.string().uuid("dto.ids.appointment"),
  reason: z.enum(["CUSTOMER_REQUEST", "PROFESSIONAL_UNAVAILABLE", "SCHEDULING_CONFLICT", "OTHER"], {
    errorMap: () => ({ message: "dto.common.cancellationReasonRequired" }),
  }),
  note: z
    .string()
    .trim()
    .max(MAX_CANCELLATION_NOTE_LENGTH, "maxLength")
    .optional()
    .or(z.literal("")),
});
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const listAppointmentsSchema = z.object({
  filter: z.enum(["upcoming", "past", "cancelled"]).optional(),
});
export type ListAppointmentsInput = z.infer<typeof listAppointmentsSchema>;

/** Order / Job Lifecycle module (Module 11). */
export const completeAppointmentSchema = z.object({
  appointmentId: z.string().uuid("dto.ids.appointment"),
});
export type CompleteAppointmentInput = z.infer<typeof completeAppointmentSchema>;
