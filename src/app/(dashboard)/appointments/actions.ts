"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import {
  cancelAppointmentSchema,
  completeAppointmentSchema,
  confirmAppointmentSchema,
  proposeAppointmentTimeSchema,
  rescheduleAppointmentSchema,
} from "@/application/dto/booking.dto";
import {
  makeCancelAppointmentUseCase,
  makeCompleteAppointmentUseCase,
  makeConfirmAppointmentUseCase,
  makeProposeAppointmentTimeUseCase,
  makeRescheduleAppointmentUseCase,
} from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

// Same translation convention as every other module's actions.ts (see
// quotes/actions.ts): domain errors surface their own safe, user-facing
// message; anything else is logged server-side and replaced with a
// generic one.
// Module 120 — Multilingual Localization: fallbacks are keys in
// `customer.appointments.errors`, resolved in the request's locale.
type FallbackKey = "proposeFailed" | "confirmFailed" | "cancelFailed" | "completeFailed" | "rescheduleFailed";

async function fromDomainError(error: unknown, fallbackKey: FallbackKey): Promise<ActionResult> {
  const t = await getTranslations("customer.appointments.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

async function invalidAppointment(): Promise<ActionResult> {
  const t = await getTranslations("customer.appointments.errors");
  return { success: false, error: t("invalidAppointment") };
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
    return { success: false, error: await localizeZodError(parsed.error) };
  }

  try {
    await makeProposeAppointmentTimeUseCase().execute(user.id, parsed.data.appointmentId, parsed.data.start, parsed.data.end);
    revalidatePath(`/appointments/${appointmentId}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard/professional/appointments");
    revalidatePath(`/dashboard/professional/appointments/${appointmentId}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "proposeFailed");
  }
}

export async function confirmAppointmentAction(appointmentId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = confirmAppointmentSchema.safeParse({ appointmentId });
  if (!parsed.success) {
    return invalidAppointment();
  }

  try {
    await makeConfirmAppointmentUseCase().execute(user.id, parsed.data.appointmentId);
    revalidatePath(`/appointments/${appointmentId}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard/professional/appointments");
    revalidatePath(`/dashboard/professional/appointments/${appointmentId}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "confirmFailed");
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
    return { success: false, error: await localizeZodError(parsed.error) };
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
    return fromDomainError(error, "cancelFailed");
  }
}

export async function completeAppointmentAction(appointmentId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = completeAppointmentSchema.safeParse({ appointmentId });
  if (!parsed.success) {
    return invalidAppointment();
  }

  try {
    await makeCompleteAppointmentUseCase().execute(user.id, parsed.data.appointmentId);
    revalidatePath(`/appointments/${appointmentId}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard/professional/appointments");
    revalidatePath(`/dashboard/professional/appointments/${appointmentId}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "completeFailed");
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
    return { success: false, error: await localizeZodError(parsed.error) };
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
    return fromDomainError(error, "rescheduleFailed");
  }
}
