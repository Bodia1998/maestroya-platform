"use server";

import { revalidatePath } from "next/cache";

import {
  cancelAppointmentSchema,
  confirmAppointmentSchema,
  proposeAppointmentTimeSchema,
  rescheduleAppointmentSchema,
} from "@/application/dto/booking.dto";
import {
  makeCancelAppointmentUseCase,
  makeConfirmAppointmentUseCase,
  makeProposeAppointmentTimeUseCase,
  makeRescheduleAppointmentUseCase,
} from "@/application/use-cases/booking/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

// Same translation convention as every other module's actions.ts (see
// quotes/actions.ts): domain errors surface their own safe, user-facing
// message; anything else is logged server-side and replaced with a
// generic one.
function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

// Both the customer- and professional-side appointment pages import these
// same actions — authorization (which side the caller is on, and whether
// they're a participant in this specific appointment at all) is resolved
// entirely inside the use cases via resolveAppointmentActor, never here.
// `appointmentId` is always re-verified server-side against the caller's
// session; it is never trusted as proof of ownership just because it was
// passed in — see each use case's own doc comment.

export async function proposeAppointmentTimeAction(
  appointmentId: string,
  start: Date,
  end: Date,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = proposeAppointmentTimeSchema.safeParse({ appointmentId, start, end });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid appointment time." };
  }

  try {
    await makeProposeAppointmentTimeUseCase().execute(user.id, parsed.data.appointmentId, parsed.data.start, parsed.data.end);
    revalidatePath(`/appointments/${appointmentId}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard/professional/appointments");
    revalidatePath(`/dashboard/professional/appointments/${appointmentId}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong proposing this time.");
  }
}

export async function confirmAppointmentAction(appointmentId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = confirmAppointmentSchema.safeParse({ appointmentId });
  if (!parsed.success) {
    return { success: false, error: "Invalid appointment." };
  }

  try {
    await makeConfirmAppointmentUseCase().execute(user.id, parsed.data.appointmentId);
    revalidatePath(`/appointments/${appointmentId}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard/professional/appointments");
    revalidatePath(`/dashboard/professional/appointments/${appointmentId}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong confirming this appointment.");
  }
}

export async function cancelAppointmentAction(
  appointmentId: string,
  reason: string,
  note: string,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = cancelAppointmentSchema.safeParse({ appointmentId, reason, note });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  }

  try {
    await makeCancelAppointmentUseCase().execute(
      user.id,
      parsed.data.appointmentId,
      parsed.data.reason,
      parsed.data.note ? parsed.data.note : null,
    );
    revalidatePath(`/appointments/${appointmentId}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard/professional/appointments");
    revalidatePath(`/dashboard/professional/appointments/${appointmentId}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong cancelling this appointment.");
  }
}

export async function rescheduleAppointmentAction(
  appointmentId: string,
  start: Date,
  end: Date,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = rescheduleAppointmentSchema.safeParse({ appointmentId, start, end });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid appointment time." };
  }

  try {
    const result = await makeRescheduleAppointmentUseCase().execute(
      user.id,
      parsed.data.appointmentId,
      parsed.data.start,
      parsed.data.end,
    );
    revalidatePath(`/appointments/${appointmentId}`);
    revalidatePath(`/appointments/${result.next.id}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard/professional/appointments");
    revalidatePath(`/dashboard/professional/appointments/${appointmentId}`);
    revalidatePath(`/dashboard/professional/appointments/${result.next.id}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong rescheduling this appointment.");
  }
}
