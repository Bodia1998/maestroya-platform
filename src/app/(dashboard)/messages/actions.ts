"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { sendMessageSchema } from "@/application/dto/chat.dto";
import {
  makeDeleteMessageUseCase,
  makeMarkConversationReadUseCase,
  makeOpenConversationUseCase,
  makeSendMessageUseCase,
} from "@/application/use-cases/chat/compose";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

// Same translation convention as every other module's actions.ts: domain
// errors surface their own (safe, user-facing) message, anything else is
// logged server-side and replaced with a generic message.
// Module 120 — Multilingual Localization: fallbacks are keys in
// `customer.messages.errors`, resolved in the request's locale.
async function fromDomainError(
  error: unknown,
  fallbackKey: "openFailed" | "sendFailed" | "generic" | "deleteFailed",
): Promise<ActionResult> {
  const t = await getTranslations("customer.messages.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

/**
 * Opens (or resumes) the conversation for a ServiceRequest, then redirects
 * straight into it. Used by both sides:
 *  - a customer supplies `professionalProfileId` (picking which professional
 *    of possibly several who quoted to talk to);
 *  - a professional supplies neither — OpenConversationUseCase resolves the
 *    customer automatically from their own quote on the request.
 * Ownership/eligibility is fully re-verified inside the use case; the ids
 * here are never trusted as proof of a relationship on their own.
 */
export async function openConversationAction(
  serviceRequestId: string,
  professionalProfileId?: string,
): Promise<ActionResult> {
  const user = await requireAuth();

  let conversationId: string;
  try {
    const conversation = await makeOpenConversationUseCase().execute(
      user.id,
      serviceRequestId,
      professionalProfileId,
    );
    conversationId = conversation.id;
  } catch (error) {
    return fromDomainError(error, "openFailed");
  }

  // redirect() throws internally (Next.js control-flow signal) — must run
  // outside the try/catch above so it isn't swallowed as a "real" error.
  redirect(`/messages/${conversationId}`);
}

/**
 * Communication abuse (Module 24, threat D) — message-spam/flood
 * protection, the "future policy layer" SendMessageUseCase's own doc
 * comment anticipates, applied here at the Server Action boundary rather
 * than inside the use case itself (no persistence-layer change needed).
 */
export async function sendMessageAction(formData: FormData): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = sendMessageSchema.safeParse({
    conversationId: formData.get("conversationId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }

  const antiAbuse = makeAntiAbuseService();
  try {
    await antiAbuse.assertNotBlocked(user.id);
    await antiAbuse.enforceRateLimit("MESSAGE_SEND_BY_USER", { userId: user.id }, "MESSAGE_RATE_LIMITED");
  } catch (error) {
    if (error instanceof DomainError) {
      return { success: false, error: await localizeActionError(error) };
    }
    throw error;
  }

  try {
    await makeSendMessageUseCase().execute(user.id, parsed.data.conversationId, parsed.data.body);
    revalidatePath(`/messages/${parsed.data.conversationId}`);
    revalidatePath("/messages");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "sendFailed");
  }
}

export async function markConversationReadAction(conversationId: string): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeMarkConversationReadUseCase().execute(user.id, conversationId);
    revalidatePath("/messages");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "generic");
  }
}

export async function deleteMessageAction(conversationId: string, messageId: string): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeDeleteMessageUseCase().execute(user.id, messageId);
    revalidatePath(`/messages/${conversationId}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "deleteFailed");
  }
}
