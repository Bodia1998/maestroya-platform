"use server";

import { adminActionFailure } from "../_lib/action-errors";
import { localizeZodError } from "@/presentation/i18n/server";
import { revalidatePath } from "next/cache";

import {
  assignSupportTicketSchema,
  changeSupportTicketStatusSchema,
  closeSupportTicketSchema,
  listAdminSupportTicketsSchema,
  resolveSupportTicketSchema,
} from "@/application/dto/support-ticket.dto";
import {
  makeAssignSupportTicketUseCase,
  makeChangeSupportTicketStatusUseCase,
  makeCloseSupportTicketUseCase,
  makeGetAdminSupportTicketUseCase,
  makeListAdminSupportTicketsUseCase,
  makeResolveSupportTicketUseCase,
} from "@/application/use-cases/support-ticket/compose";
import type { SupportTicketRecord } from "@/domain/repositories/support-ticket-repository";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/** Module 21 — Disputes & Support: admin SupportTicket Server Actions —
 *  mirrors admin/disputes/actions.ts. */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

export async function listAdminSupportTicketsAction(
  input: Record<string, unknown> = {},
): Promise<ActionResult<SupportTicketRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = listAdminSupportTicketsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const tickets = await makeListAdminSupportTicketsUseCase().execute(parsed.data);
    return { success: true, data: tickets };
  } catch (error) {
    return adminActionFailure(error, "loadingTickets");
  }
}

export async function getAdminSupportTicketAction(ticketId: string): Promise<ActionResult<SupportTicketRecord>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  try {
    const ticket = await makeGetAdminSupportTicketUseCase().execute(ticketId);
    return { success: true, data: ticket };
  } catch (error) {
    return adminActionFailure(error, "loadingThisTicket");
  }
}

export async function assignSupportTicketAction(ticketId: string, adminUserId: string | null): Promise<ActionResult<SupportTicketRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = assignSupportTicketSchema.safeParse({ ticketId, adminUserId });
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const ticket = await makeAssignSupportTicketUseCase().execute(admin.id, parsed.data.ticketId, parsed.data.adminUserId);
    revalidatePath(`/admin/support-tickets/${ticketId}`);
    return { success: true, data: ticket };
  } catch (error) {
    return adminActionFailure(error, "assigningThisTicket");
  }
}

export async function changeSupportTicketStatusAction(ticketId: string, status: string): Promise<ActionResult<SupportTicketRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = changeSupportTicketStatusSchema.safeParse({ ticketId, status });
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const ticket = await makeChangeSupportTicketStatusUseCase().execute(admin.id, parsed.data.ticketId, parsed.data.status);
    revalidatePath(`/admin/support-tickets/${ticketId}`);
    return { success: true, data: ticket };
  } catch (error) {
    return adminActionFailure(error, "changingThisTicketStatus");
  }
}

export async function resolveSupportTicketAction(ticketId: string, resolutionNote: string): Promise<ActionResult<SupportTicketRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = resolveSupportTicketSchema.safeParse({ ticketId, resolutionNote });
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const ticket = await makeResolveSupportTicketUseCase().execute(admin.id, parsed.data.ticketId, parsed.data.resolutionNote);
    revalidatePath(`/admin/support-tickets/${ticketId}`);
    return { success: true, data: ticket };
  } catch (error) {
    return adminActionFailure(error, "resolvingThisTicket");
  }
}

export async function closeSupportTicketAction(ticketId: string): Promise<ActionResult<SupportTicketRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = closeSupportTicketSchema.safeParse({ ticketId });
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const ticket = await makeCloseSupportTicketUseCase().execute(admin.id, parsed.data.ticketId);
    revalidatePath(`/admin/support-tickets/${ticketId}`);
    return { success: true, data: ticket };
  } catch (error) {
    return adminActionFailure(error, "closingThisTicket");
  }
}
