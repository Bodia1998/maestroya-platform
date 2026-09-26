"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { createSupportTicketSchema, listMySupportTicketsSchema } from "@/application/dto/support-ticket.dto";
import {
  makeCreateSupportTicketUseCase,
  makeGetSupportTicketByIdUseCase,
  makeListMySupportTicketsUseCase,
} from "@/application/use-cases/support-ticket/compose";
import type { SupportTicketRecord } from "@/domain/repositories/support-ticket-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

/** Module 21 — Disputes & Support: customer/professional-facing
 *  SupportTicket Server Actions — mirrors disputes/actions.ts. */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

// Module 120 — Multilingual Localization: fallbacks are keys in
// `customer.support.errors`, resolved in the request's locale.
async function fromDomainError<T>(error: unknown, fallbackKey: "openFailed" | "loadFailed" | "loadOneFailed"): Promise<ActionResult<T>> {
  const t = await getTranslations("customer.support.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

export async function createSupportTicketAction(input: {
  category: string;
  subject: string;
  description: string;
}): Promise<ActionResult<SupportTicketRecord>> {
  const user = await requireAuth();
  const parsed = createSupportTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const ticket = await makeCreateSupportTicketUseCase().execute(user.id, parsed.data);
    revalidatePath("/support-tickets");
    return { success: true, data: ticket };
  } catch (error) {
    return fromDomainError(error, "openFailed");
  }
}

export async function listMySupportTicketsAction(
  input: { limit?: number; offset?: number; status?: string } = {},
): Promise<ActionResult<SupportTicketRecord[]>> {
  const user = await requireAuth();
  const parsed = listMySupportTicketsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const tickets = await makeListMySupportTicketsUseCase().execute(user.id, parsed.data);
    return { success: true, data: tickets };
  } catch (error) {
    return fromDomainError(error, "loadFailed");
  }
}

export async function getSupportTicketAction(ticketId: string): Promise<ActionResult<SupportTicketRecord>> {
  const user = await requireAuth();
  try {
    const ticket = await makeGetSupportTicketByIdUseCase().execute(user.id, ticketId);
    return { success: true, data: ticket };
  } catch (error) {
    return fromDomainError(error, "loadOneFailed");
  }
}
