"use server";

import { revalidatePath } from "next/cache";

import { createSupportTicketSchema, listMySupportTicketsSchema } from "@/application/dto/support-ticket.dto";
import {
  makeCreateSupportTicketUseCase,
  makeGetSupportTicketByIdUseCase,
  makeListMySupportTicketsUseCase,
} from "@/application/use-cases/support-ticket/compose";
import { DomainError } from "@/domain/errors/domain-error";
import type { SupportTicketRecord } from "@/domain/repositories/support-ticket-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";

/** Module 21 — Disputes & Support: customer/professional-facing
 *  SupportTicket Server Actions — mirrors disputes/actions.ts. */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function createSupportTicketAction(input: {
  category: string;
  subject: string;
  description: string;
}): Promise<ActionResult<SupportTicketRecord>> {
  const user = await requireAuth();
  const parsed = createSupportTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid ticket." };
  }
  try {
    const ticket = await makeCreateSupportTicketUseCase().execute(user.id, parsed.data);
    revalidatePath("/support-tickets");
    return { success: true, data: ticket };
  } catch (error) {
    return fromDomainError(error, "Something went wrong opening this ticket.");
  }
}

export async function listMySupportTicketsAction(
  input: { limit?: number; offset?: number; status?: string } = {},
): Promise<ActionResult<SupportTicketRecord[]>> {
  const user = await requireAuth();
  const parsed = listMySupportTicketsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const tickets = await makeListMySupportTicketsUseCase().execute(user.id, parsed.data);
    return { success: true, data: tickets };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading your tickets.");
  }
}

export async function getSupportTicketAction(ticketId: string): Promise<ActionResult<SupportTicketRecord>> {
  const user = await requireAuth();
  try {
    const ticket = await makeGetSupportTicketByIdUseCase().execute(user.id, ticketId);
    return { success: true, data: ticket };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this ticket.");
  }
}
