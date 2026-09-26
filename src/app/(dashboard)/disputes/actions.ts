"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import {
  addDisputeEvidenceSchema,
  addDisputeMessageSchema,
  createDisputeSchema,
  listMyDisputesSchema,
} from "@/application/dto/dispute.dto";
import {
  makeAddDisputeEvidenceUseCase,
  makeAddDisputeMessageUseCase,
  makeCreateDisputeUseCase,
  makeGetDisputeByIdUseCase,
  makeListDisputesAgainstMeUseCase,
  makeListMyDisputesUseCase,
} from "@/application/use-cases/dispute/compose";
import type { DisputeRecord } from "@/domain/repositories/dispute-repository";
import type { DisputeDetail } from "@/application/use-cases/dispute/get-dispute-by-id.use-case";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

/**
 * Module 21 — Disputes & Support: customer/professional-facing Server
 * Action adapters — same "thin adapter, business logic in the use case"
 * convention as reviews/actions.ts. Every action derives the caller from
 * `requireAuth()` and re-verifies ownership inside the composed use case
 * (never trusting a client-supplied ownership claim) — see
 * resolveDisputeActor's own doc comment for the IDOR-prevention guarantee
 * this relies on.
 */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

// Module 120 — Multilingual Localization: fallbacks are keys in
// `customer.disputes.errors`, resolved in the request's locale.
async function fromDomainError<T>(error: unknown, fallbackKey: "openFailed" | "loadMineFailed" | "loadFailed" | "loadOneFailed" | "messageFailed" | "evidenceFailed"): Promise<ActionResult<T>> {
  const t = await getTranslations("customer.disputes.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

export async function createDisputeAction(input: {
  jobId: string;
  reason: string;
  title: string;
  description: string;
}): Promise<ActionResult<DisputeRecord>> {
  const user = await requireAuth();
  const parsed = createDisputeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const dispute = await makeCreateDisputeUseCase().execute(user.id, parsed.data);
    revalidatePath("/disputes");
    return { success: true, data: dispute };
  } catch (error) {
    return fromDomainError(error, "openFailed");
  }
}

export async function listMyDisputesAction(
  input: { limit?: number; offset?: number; status?: string } = {},
): Promise<ActionResult<DisputeRecord[]>> {
  const user = await requireAuth();
  const parsed = listMyDisputesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const disputes = await makeListMyDisputesUseCase().execute(user.id, parsed.data);
    return { success: true, data: disputes };
  } catch (error) {
    return fromDomainError(error, "loadMineFailed");
  }
}

export async function listDisputesAgainstMeAction(): Promise<ActionResult<DisputeRecord[]>> {
  const user = await requireAuth();
  try {
    const disputes = await makeListDisputesAgainstMeUseCase().execute(user.id);
    return { success: true, data: disputes };
  } catch (error) {
    return fromDomainError(error, "loadFailed");
  }
}

export async function getDisputeAction(disputeId: string): Promise<ActionResult<DisputeDetail>> {
  const user = await requireAuth();
  try {
    const detail = await makeGetDisputeByIdUseCase().execute(user.id, disputeId);
    return { success: true, data: detail };
  } catch (error) {
    return fromDomainError(error, "loadOneFailed");
  }
}

export async function addDisputeMessageAction(disputeId: string, body: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = addDisputeMessageSchema.safeParse({ disputeId, body });
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    await makeAddDisputeMessageUseCase().execute(user.id, parsed.data.disputeId, parsed.data.body);
    revalidatePath(`/disputes/${disputeId}`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "messageFailed");
  }
}

export async function addDisputeEvidenceAction(input: {
  disputeId: string;
  fileUrl: string;
  fileName?: string;
  fileType?: string;
  fileSizeBytes?: number;
  description?: string;
}): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = addDisputeEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    await makeAddDisputeEvidenceUseCase().execute(user.id, parsed.data.disputeId, {
      fileUrl: parsed.data.fileUrl,
      fileName: parsed.data.fileName ?? null,
      fileType: parsed.data.fileType ?? null,
      fileSizeBytes: parsed.data.fileSizeBytes ?? null,
      description: parsed.data.description ? parsed.data.description : null,
    });
    revalidatePath(`/disputes/${input.disputeId}`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "evidenceFailed");
  }
}
